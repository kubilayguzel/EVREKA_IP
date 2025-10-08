// functions/index.js
import admin from 'firebase-admin';
import path from 'path';
import os from 'os';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { createExtractorFromFile } from 'node-unrar-js';
import nodemailer from 'nodemailer';
import stream from 'stream';
import { pipeline } from 'stream/promises';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import logger from 'firebase-functions/logger';
import cors from 'cors';
import fetch from 'node-fetch';
import { PubSub } from '@google-cloud/pubsub';
import archiver from 'archiver';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
         WidthType, AlignmentType, HeadingLevel, PageBreak } from 'docx';
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { google } from "googleapis";
import { auth } from 'firebase-functions/v1';
import { getAuth } from 'firebase-admin/auth';                          // Admin SDK (modüler)
import { getFirestore, FieldValue } from 'firebase-admin/firestore';    // Admin SDK (modüler)
import { addMonthsToDate, findNextWorkingDay, isHoliday, isWeekend, TURKEY_HOLIDAYS } from '../utils.js';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const adminAuth = admin.auth();
const adminDb = admin.firestore();
const db        = adminDb;
const secretClient = new SecretManagerServiceClient();

// 🔐 SA_MAILER_KEY'i Secret Manager'dan çek
async function loadMailerSA() {
  const name = `projects/${process.env.GCLOUD_PROJECT}/secrets/SA_MAILER_KEY/versions/latest`;
  const [ver] = await secretClient.accessSecretVersion({ name });
  return JSON.parse(ver.payload.data.toString("utf8")); // { client_email, private_key, ... }
}

// ✅ Göndermeye yetkili kişiler
const ALLOWED_SENDERS = new Set([
  "alikucuksahin@evrekapatent.com",
  "bekirguven@evrekapatent.com",
  "kubilayguzel@evrekapatent.com",
  "erhankocabacak@evrekapatent.com",
  "selcanakoglu@evrekapatent.com",
  "hukuk@evrekapatent.com",
  "beyzasevinc@evrekapatent.com",
  "yigitdemirtas@evrekapatent.com",
  "rumeysatimurlenk@evrekapatent.com"
]);

// 📧 Gmail API ile "kullanıcının adına" gönderim
async function sendViaGmailAsUser(userEmail, mailOptions) {
  const sa = await loadMailerSA();

  // 1) Nodemailer ile MIME üret (ekleri de dahil)
  const streamTransport = nodemailer.createTransport({
    streamTransport: true,
    newline: "unix",
    buffer: true
  });

  const compiled = await streamTransport.sendMail({
    ...mailOptions,
    from: `"${mailOptions.fromName || "IP Manager"}" <${userEmail}>`,
    sender: undefined,
    replyTo: mailOptions.replyTo || userEmail
  });

  const raw = Buffer.from(compiled.message)
    .toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // 2) Domain-Wide Delegation ile o kullanıcı adına yetkilendirme
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: userEmail      // << kullanıcı adına gönder
  });

  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw }
  });

  return res.data; // { id, ... }
}


// Firebase Admin SDK'sını başlatın
if (!admin.apps.length) {
  admin.initializeApp();
}
const pubsubClient = new PubSub(); // pubsubClient'ı burada tanımlayın

// ********************************************************************************
async function ensureTopic(name) {
  try {
    const [exists] = await pubsubClient.topic(name).exists();
    if (!exists) {
      await pubsubClient.createTopic(name);
      console.log(`🆕 Pub/Sub topic created: ${name}`);
    }
  } catch (err) {
    console.error(`⚠️ ensureTopic error for ${name}:`, err.message || err);
    throw err;
  }
}

// CORS ayarları
const corsOptions = {
    origin: [
        'https://kubilayguzel.github.io',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5173'
    ],
    credentials: true,
    optionsSuccessStatus: 200
};
const corsHandler = cors(corsOptions);

// SMTP transporter configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "kubilayguzel@evrekapatent.com",
    pass: "rqvl tpbm vkmu lmxi"
  }
});

// =========================================================
//              HTTPS FONKSİYONLARI (v2)
// =========================================================

// ETEBS API Proxy Function (v2 sözdizimi)
export const etebsProxyV2 = onRequest(
    {
        region: 'europe-west1',
        timeoutSeconds: 120,
        memory: '256MiB'
    },
    async (req, res) => {
        return corsHandler(req, res, async () => {
            if (req.method !== 'POST') {
                return res.status(405).json({
                    success: false,
                    error: 'Method not allowed'
                });
            }

            try {
                console.log('🔥 ETEBS Proxy request:', req.body);

                const { action, token, documentNo, userId } = req.body;

                if (!action || !token) {
                    return res.status(400).json({
                        success: false,
                        error: 'Missing required parameters'
                    });
                }

                let apiUrl = '';
                let requestBody = { TOKEN: token };
                let etebsData;

                switch (action) {
                    case 'daily-notifications':
                        apiUrl = 'https://epats.turkpatent.gov.tr/service/TP/DAILY_NOTIFICATIONS?apikey=etebs';
                        const etebsResponse = await fetch(apiUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(requestBody),
                            timeout: 30000
                        });
                        if (!etebsResponse.ok) {
                            throw new Error(`ETEBS API HTTP ${etebsResponse.status}: ${etebsResponse.statusText}`);
                        }
                        etebsData = await etebsResponse.json();
                        break;

                    case 'download-document':
                        if (!documentNo) {
                            return res.status(400).json({
                                success: false,
                                error: 'Document number required for download'
                            });
                        }
                        apiUrl = 'https://epats.turkpatent.gov.tr/service/TP/DOWNLOAD_DOCUMENT?apikey=etebs';
                        requestBody.DOCUMENT_NO = documentNo;
                        
                        const etebsDownloadResponse = await fetch(apiUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'User-Agent': 'IP-Manager-ETEBS-Proxy/1.0'
                            },
                            body: JSON.stringify(requestBody),
                            timeout: 30000
                        });
                        if (!etebsDownloadResponse.ok) {
                            throw new Error(`ETEBS API HTTP ${etebsDownloadResponse.status}: ${etebsDownloadResponse.statusText}`);
                        }
                        
                        const etebsRawData = await etebsDownloadResponse.json();
                        const downloadResult = etebsRawData.DownloadDocumentResult || [];
                        
                        if (downloadResult.length > 0) {
                            const firstDoc = downloadResult[0];
                            const base64Data = firstDoc.BASE64;
                            const belgeAciklamasi = firstDoc.BELGE_ACIKLAMASI;
                            
                            // Base64'ten Buffer'a dönüştür
                            const pdfBuffer = Buffer.from(base64Data, 'base64');
                            
                            // Dosya adı ve yolu oluştur
                            const fileName = `${documentNo}_${belgeAciklamasi.replace(/[^a-zA-Z0-9_]/g, '')}.pdf`;
                            const storagePath = `etebs_documents/${userId || 'anonymous'}/${documentNo}/${fileName}`;
                            
                            // Dosyayı Firebase Storage'a yükle
                            const file = admin.storage().bucket().file(storagePath);
                            await file.save(pdfBuffer, { contentType: 'application/pdf' });
                            
                            // Firestore'a dosya bilgisini kaydet
                            const firestoreDocRef = adminDb.collection('unindexed_pdfs').doc();
                            await firestoreDocRef.set({
                                evrakNo: documentNo,
                                belgeAciklamasi: belgeAciklamasi,
                                fileName: fileName,
                                filePath: storagePath,
                                fileUrl: `https://storage.googleapis.com/${admin.storage().bucket().name}/${storagePath}`,
                                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                                status: 'pending',
                                source: 'etebs'
                            });
                            
                            // İstemciye başarı durumunu ve dosya URL'ini döndür
                            etebsData = {
                                fileUrl: `https://storage.googleapis.com/${admin.storage().bucket().name}/${storagePath}`,
                                unindexedPdfId: firestoreDocRef.id,
                                message: 'Evrak başarıyla kaydedildi'
                            };

                        } else {
                             etebsData = { success: false, error: 'Evraka ait ek bulunamadı.', errorCode: '006' };
                        }
                        break;
                    default:
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid action'
                        });
                }

                console.log('✅ ETEBS API response received');

                res.json({
                    success: true,
                    data: etebsData,
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                console.error('❌ ETEBS Proxy Error:', error);
                res.status(500).json({
                    success: false,
                    error: 'Internal proxy error',
                    code: 'PROXY_ERROR',
                    message: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
        });
    }
);

// Health Check Function (v2 sözdizimi)
export const etebsProxyHealthV2 = onRequest(
    {
        region: 'europe-west1'
    },
    (req, res) => {
        return corsHandler(req, res, () => {
            res.json({
                status: 'healthy',
                service: 'ETEBS Proxy',
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            });
        });
    }
);

// ETEBS Token Validation Function (v2 sözdizimi)
export const validateEtebsTokenV2 = onRequest(
    {
        region: 'europe-west1'
    },
    (req, res) => {
        return corsHandler(req, res, () => {
            if (req.method !== 'POST') {
                return res.status(405).json({ error: 'Method not allowed' });
            }

            const { token } = req.body;

            if (!token) {
                return res.status(400).json({
                    valid: false,
                    error: 'Token required'
                });
            }

            const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

            if (!guidRegex.test(token)) {
                return res.status(400).json({
                    valid: false,
                    error: 'Invalid token format'
                });
            }

            res.json({
                valid: true,
                format: 'GUID',
                timestamp: new Date().toISOString()
            });
        });
    }
);
// Storage'taki PDF dosyasını bulup Nodemailer'a eklenti (attachment) olarak vermek.
async function buildNotificationAttachments(db, notificationData) {
  const result = { attachments: [], footerItems: [] };
  const MAX_BYTES = 20 * 1024 * 1024; // 20MB
  const bucket = admin.storage().bucket();

  const safeName = (name, def = "document.pdf") =>
    String(name || def).replace(/[^\w.\-]+/g, "_").slice(0, 100);

  const pathFromURL = (url) => {
    try {
      const m = new URL(url).pathname.match(/\/o\/(.+?)(?:\?|$)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch { return null; }
  };

  const addAsAttachmentOrLink = async ({ storagePath, downloadURL, fileName }) => {
    const name = safeName(fileName);
    if (!storagePath) {
      // path yoksa linke düş
      if (downloadURL) {
        result.footerItems.push(
          `<a href="${downloadURL}" target="_blank" rel="noopener">${name}</a>`
        );
      } else {
        result.footerItems.push(name);
      }
      return true;
    }
    try {
      const [meta] = await bucket.file(storagePath).getMetadata();
      const size = Number(meta.size || 0);
      if (size > MAX_BYTES) {
        if (downloadURL) {
          result.footerItems.push(
            `<a href="${downloadURL}" target="_blank" rel="noopener">${name}</a>`
          );
        } else {
          result.footerItems.push(name);
        }
        return true;
      }
      const [buf] = await bucket.file(storagePath).download();
      result.attachments.push({
        filename: name,
        content: buf,
        contentType: "application/pdf",
      });
      return true;
    } catch (e) {
      // storage erişilemezse son çare link
      if (downloadURL) {
        result.footerItems.push(
          `<a href="${downloadURL}" target="_blank" rel="noopener">${name}</a>`
        );
        return true;
      }
      return false;
    }
  };

  try {
    console.log("🔍 [ATTACH] builder start", {
      associatedTaskId: notificationData?.associatedTaskId,
      sourceDocumentId: notificationData?.sourceDocumentId,
    });

    // 1) ÖNCE: Task → EPATS (TaskComplete akışı)
    const taskId = notificationData?.associatedTaskId;
    if (taskId) {
      try {
        const t = await adminDb.collection("tasks").doc(taskId).get();
        const ep = t.exists ? (t.data()?.details?.epatsDocument || null) : null;
        if (ep) {
          let storagePath = ep.storagePath || pathFromURL(ep.downloadURL || ep.fileUrl);
          await addAsAttachmentOrLink({
            storagePath,
            downloadURL: ep.downloadURL || ep.fileUrl || null,
            fileName: ep.name || "epats.pdf",
          });
          return result; // EPATS bulunduysa burada biter
        }
      } catch (e) {
        console.warn("⚠️ [ATTACH] task/EPATS okunamadı:", e?.message || e);
      }
    }

    // 2) SONRA: unindexed_pdfs (DocumentStatusChange akışı)
    const docId = notificationData?.sourceDocumentId;
    if (docId) {
      try {
        const u = await adminDb.collection("unindexed_pdfs").doc(docId).get();
        if (u.exists) {
          const d = u.data() || {};
          let storagePath = d.filePath || pathFromURL(d.fileUrl || d.downloadURL);
          await addAsAttachmentOrLink({
            storagePath,
            downloadURL: d.fileUrl || d.downloadURL || null,
            fileName: d.fileName || "document.pdf",
          });
          return result;
        }
      } catch (e) {
        console.warn("⚠️ [ATTACH] unindexed_pdfs okunamadı:", e?.message || e);
      }
    }

    // 3) Aksi halde ek yok
    return result;
  } catch (err) {
    console.error("❌ [ATTACH] Genel hata:", err);
    return result;
  }
}

export const createObjectionTask = onCall({ region: 'europe-west1' }, async (request) => {
const { monitoredMarkId, similarMark, bulletinNo, callerEmail } = request.data || {};

  // ✅ 1. Bülten tarihini al
  let bulletinDate = null;        // Date | null
  let bulletinDateStr = null;     // string | null

  try {
    const bulletinQuery = await admin.firestore()
      .collection('trademarkBulletins')
      .where('bulletinNo', '==', bulletinNo)
      .limit(1)
      .get();

    if (!bulletinQuery.empty) {
      const bulletinData = bulletinQuery.docs[0].data();
      bulletinDateStr = bulletinData.bulletinDate; // "12/08/2025" formatında

      // "DD/MM/YYYY" → Date objesi
      if (bulletinDateStr && typeof bulletinDateStr === 'string') {
        const parts = bulletinDateStr.split('/');
        bulletinDate = new Date(
          parseInt(parts[2], 10),
          parseInt(parts[1], 10) - 1,
          parseInt(parts[0], 10)
        );
        bulletinDate.setHours(0, 0, 0, 0);

        console.log('✅ Bülten tarihi bulundu:', {
          bulletinNo,
          bulletinDateStr,
          bulletinDate: bulletinDate.toISOString(),
        });
      }
    } else {
      console.warn('⚠️ Bülten bulunamadı:', bulletinNo);
    }
  } catch (err) {
    console.error('❌ Bülten tarihi alınamadı:', err);
  }

  // ✅ 2. dueDate hesaplama: Bülten tarihi + 2 ay
  let officialDueDate = null;      // Date | null
  let operationalDueDate = null;   // Date | null
  let dueDateDetails = null;       // any

  if (bulletinDate) {
    try {
      // 1) Bülten tarihine 2 ay ekle
      const rawDueDate = addMonthsToDate(bulletinDate, 2);

      // 2) Resmi tatil/hafta sonu → ilk iş gününe kaydır
      officialDueDate = findNextWorkingDay(rawDueDate, TURKEY_HOLIDAYS);

      // 3) Operasyonel son tarih = Resmi son tarih - 3 gün
      const tempOperationalDueDate = new Date(officialDueDate);
      tempOperationalDueDate.setDate(officialDueDate.getDate() - 3);
      tempOperationalDueDate.setHours(0, 0, 0, 0);

      // 4) Operasyonel tarihi de tatil kontrolünden geçir (geriye doğru)
      let checkDate = new Date(tempOperationalDueDate);
      while (isWeekend(checkDate) || isHoliday(checkDate, TURKEY_HOLIDAYS)) {
        checkDate.setDate(checkDate.getDate() - 1);
      }
      operationalDueDate = checkDate;

      // 5) Hesaplama detayları
      dueDateDetails = {
        bulletinDate: bulletinDate.toISOString().split('T')[0],
        periodMonths: 2,
        originalCalculatedDate: rawDueDate.toISOString().split('T')[0],
        finalOfficialDueDate: officialDueDate.toISOString().split('T')[0],
        finalOperationalDueDate: operationalDueDate.toISOString().split('T')[0],
        adjustments: [],
      };

      console.log('✅ dueDate hesaplandı:', dueDateDetails);
    } catch (err) {
      console.error('❌ dueDate hesaplama hatası:', err);
    }
  } else {
    console.warn('⚠️ Bülten tarihi bulunamadı, dueDate hesaplanamadı');
  }

  // ✅ 3. Task verilerini oluştur
  // TODO: clientId kaynağını kendi akışınıza göre doldurun
  const clientId = /* örn. similarMark.clientId veya monitoredMark dokümanından */ null;

  const taskData = {
    taskType: "20",
    status: "awaiting_client_approval",
    clientId: clientId,
    dueDate: operationalDueDate ? admin.firestore.Timestamp.fromDate(operationalDueDate) : null,
    officialDueDate: officialDueDate ? admin.firestore.Timestamp.fromDate(officialDueDate) : null,
    officialDueDateDetails: dueDateDetails,
    details: {
      bulletinNo: bulletinNo,
      bulletinDate: bulletinDateStr,
      monitoredMarkId: monitoredMarkId,
      targetAppNo: similarMark.applicationNo,
      objectionTarget: similarMark.markName,
      targetNiceClasses: similarMark.niceClasses,
      similarityScore: similarMark.similarityScore,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Task'ı Firestore'a ekle
  const taskRef = await admin.firestore().collection('tasks').add(taskData);

  return {
    success: true,
    taskId: taskRef.id,
    dueDate: operationalDueDate ? operationalDueDate.toISOString() : null,
  };
});


// Send Email Notification (v2 Callable Function)
export const sendEmailNotificationV2 = onCall(
  { region: "europe-west1" },
  async (request) => {
    const { notificationId, userEmail: userEmailFromClient, mode, overrideSubject, overrideBody } = request.data || {};
    const isReminder = String(mode || "").toLowerCase() === "reminder";
    console.log("📧 [DEBUG] sendEmailNotificationV2", { notificationId, mode, hasOverrideSubject: !!overrideSubject, hasOverrideBody: !!overrideBody });

    if (!notificationId) throw new HttpsError("invalid-argument", "notificationId parametresi zorunludur.");

    const notificationRef = db.collection("mail_notifications").doc(notificationId);
    const notificationDoc = await notificationRef.get();
    if (!notificationDoc.exists) throw new HttpsError("not-found", "Bildirim bulunamadı.");

    const notificationData = notificationDoc.data();

    // Gönderici doğrulama
    const callerEmail = (request.auth?.token?.email || "").toLowerCase();
    const userEmail = (userEmailFromClient || callerEmail || "").toLowerCase();
    if (!userEmail || !ALLOWED_SENDERS.has(userEmail)) {
      throw new HttpsError("permission-denied", "Bu kullanıcı adına gönderim yetkisi yok.");
    }

    // -----------------------------
    // Alıcılar (öncelik sırası):
    // toList/ccList > toRecipients/ccRecipients > recipientTo/recipientCc > to/cc > recipientEmail
    // -----------------------------
    const norm = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) {
        return v
          .map(x => {
            if (typeof x === "string") return x.trim();
            if (x && typeof x === "object" && x.email) return String(x.email).trim();
            return "";
          })
          .filter(Boolean);
      }
      if (typeof v === "string") {
        return v.split(/[;,]\s*/).map(s => s.trim()).filter(Boolean);
      }
      return [];
    };

    const firstNonEmpty = (...cands) => {
      for (const c of cands) {
        const arr = norm(c);
        if (arr.length) return arr;
      }
      return [];
    };

    let toArr = firstNonEmpty(
      notificationData.toList,
      notificationData.toRecipients,
      notificationData.recipientTo,
      notificationData.to,
      notificationData.recipientEmail
    );
    let ccArr = firstNonEmpty(
      notificationData.ccList,
      notificationData.ccRecipients,
      notificationData.recipientCc,
      notificationData.cc
    );

    // Tekilleştir ve TO içinde olanı CC'den çıkar (aynı adrese iki kez gitmesin)
    const uniq = (a) => Array.from(new Set(a.map(s => s.toLowerCase()))); // case-insensitive uniq
    toArr = uniq(toArr);
    ccArr = uniq(ccArr).filter(x => !toArr.includes(x));

    const to = toArr.join(", ");
    const cc = ccArr.join(", ");

    console.log("📧 [DEBUG] FINAL TO:", toArr, "FINAL CC:", ccArr);

    if (!to && !cc) {
      throw new HttpsError("failed-precondition", "Gönderilecek alıcı adresi bulunamadı.");
    }

    // Ekleri hazırla (hatırlatmada ekleri kapatacağız)
    const built = await buildNotificationAttachments(db, notificationData);
    const attachmentsBuilt = built?.attachments || [];
    const footerItems = built?.footerItems || [];

    // Basit <body> ayıklayıcı (TinyMCE gövdesi için)
    const stripBody = (html) => {
      if (!html) return "";
      const m = String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      return m ? m[1] : String(html);
    };

    // Konu + Gövde
    let subject, htmlBody, attachmentsToSend;

    if (isReminder) {
      const safeOverrideSubject = (overrideSubject || "").toString().trim();
      const safeOverrideBody = stripBody((overrideBody || "").toString().trim());

      subject = safeOverrideSubject || `Hatırlatma: ${notificationData.subject || ""}`.trim();
      htmlBody = safeOverrideBody || `
        <p>Sayın İlgili,</p>
        <p>Konuyu hatırlatmak isteriz.</p>
        <p>Saygılarımızla,</p>
      `;
      attachmentsToSend = undefined; // hatırlatma yalın gitsin
    } else {
      subject = notificationData.subject || "";
      htmlBody = notificationData.body || "";

      if (footerItems.length > 0) {
        const eklerHtml = footerItems.map(item => `• ${item}`).join("<br>");
        htmlBody += `<hr><p><strong>EKLER:</strong><br>${eklerHtml}</p>`;
      }
      attachmentsToSend = attachmentsBuilt.length ? attachmentsBuilt : undefined;
    }

    const mailOptions = {
      fromName: "IP Manager",
      replyTo: userEmail,
      to, cc, subject,
      html: htmlBody,
      attachments: attachmentsToSend
    };

    try {
      const sent = await sendViaGmailAsUser(userEmail, mailOptions);

      const baseUpdate = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        sentBy: userEmail,
        provider: "gmail_api_dwd",
        gmailMessageId: sent?.id || null,
        lastAttachmentMode: (attachmentsToSend?.length ? "attachment" : (footerItems.length ? "inline_link" : "none")),
        // Son kullanılan alıcıları da kayda geçelim (teşhis için faydalı)
        lastUsedTo: toArr,
        lastUsedCc: ccArr
      };

      if (isReminder) {
        await notificationRef.update({
          ...baseUpdate,
          lastReminderAt: admin.firestore.FieldValue.serverTimestamp(),
          lastReminderBy: userEmail
        });
      } else {
        await notificationRef.update({
          ...baseUpdate,
          status: "sent",
          sentAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return { success: true, message: "E-posta gönderildi.", id: sent?.id || null };
    } catch (error) {
      console.error("💥 Gmail API gönderim hatası:", error);
      await notificationRef.update({
        status: "failed",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorInfo: error?.message || String(error)
      });
      throw new HttpsError("internal", "E-posta gönderilirken bir hata oluştu.", error?.message);
    }
  }
);

// =========================================================
//              SCHEDULER FONKSİYONLARI (v2)
// =========================================================

// Rate Limiting Function (Scheduled) (v2 sözdizimi)
export const cleanupEtebsLogsV2 = onSchedule(
    {
        schedule: 'every 24 hours',
        region: 'europe-west1'
    },
    async (event) => {
        console.log('🧹 ETEBS logs cleanup started');

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        try {
            const oldLogs = await adminDb.collection('etebs_logs')
                .where('timestamp', '<', thirtyDaysAgo)
                .limit(500)
                .get();

            const batch = db.batch();
            oldLogs.docs.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();

            console.log(`🗑️ Cleaned up ${oldLogs.docs.length} old ETEBS logs`);
        } catch (error) {
            console.error('❌ Cleanup error:', error);
        }

        return null;
    }
);

// =========================================================
//              FIRESTORE TRIGGER FONKSİYONLARI (v2)
// =========================================================
export const createMailNotificationOnDocumentIndexV2 = onDocumentCreated(
  {
    document: "indexed_documents/{docId}",
    region: "europe-west1",
  },
  async (event) => {
    const snap = event.data;
    const newDocument = snap.data();
    const docId = event.params.docId;

    console.log(`📄 Yeni belge algılandı: ${docId}`, newDocument);

    // --- Yardımcılar ---
    const normalizeType = (t) => {
      const s = String(t || "").toLowerCase();
      if (["marka", "trademark"].includes(s)) return "marka";
      if (["patent"].includes(s)) return "patent";
      if (["tasarım", "tasarim", "design"].includes(s)) return "tasarim";
      if (["dava", "litigation"].includes(s)) return "dava";
      if (["muhasebe", "finance", "accounting"].includes(s)) return "muhasebe";
      return s || "marka";
    };

    const dedupe = (arr) => Array.from(new Set((arr || []).filter(Boolean).map(x => String(x).trim())));

    const findRecipientsFromPersonsRelated = async (personIds, categoryKey) => {
      const to = [];
      const cc = [];
      if (!Array.isArray(personIds) || personIds.length === 0) return { to, cc };

      try {
        // "in" sorgusu 10 id ile sınırlıdır; 10'dan fazla ise parça parça sorgula
        const chunks = [];
        for (let i = 0; i < personIds.length; i += 10) {
          chunks.push(personIds.slice(i, i + 10));
        }
        for (const chunk of chunks) {
          const prSnap = await db
            .collection("personsRelated")
            .where("personId", "in", chunk)
            .get();

          prSnap.forEach((d) => {
            const pr = d.data();
            const email = (pr.email || "").trim();
            const isResp = pr?.responsible?.[categoryKey] === true;
            const n = pr?.notify?.[categoryKey] || {};
            if (!email || !isResp) return;
            if (n?.to === true) to.push(email);
            if (n?.cc === true) cc.push(email);
          });
        }
      } catch (e) {
        console.warn("personsRelated sorgusu hata:", e);
      }

      return { to: dedupe(to), cc: dedupe(cc) };
    };

    // --- Başlangıç değerleri ---
    const categoryKey = normalizeType(newDocument.mainProcessType || "marka");
    const notificationType = categoryKey;

    let toRecipients = [];
    let ccRecipients = [];
    let subject = "";
    let body = "";
    const missingFields = []; // sadece "recipients", "subject", "body" gibi gönderimi engelleyenler eklenecek

    try {
      // 1) Kural & Şablon (bulunamazsa bile fallback içerik oluşturacağız)
      let template = null;
      try {
        const rulesSnapshot = await db
          .collection("template_rules")
          .where("sourceType", "==", "document")
          .where("mainProcessType", "==", newDocument.mainProcessType || "marka")
          .where("subProcessType", "==", newDocument.subProcessType || null)
          .limit(1)
          .get();

        if (!rulesSnapshot.empty) {
          const rule = rulesSnapshot.docs[0].data();
          const templateSnapshot = await adminDb.collection("mail_templates").doc(rule.templateId).get();
          if (templateSnapshot.exists) template = templateSnapshot.data();
          else console.warn(`⚠️ Şablon bulunamadı: ${rule.templateId}`);
        } else {
          console.warn("⚠️ Kural bulunamadı (template_rules).");
        }
      } catch (e) {
        console.warn("Kural/şablon ararken hata:", e);
      }

      // 2) ALICILAR — ÖNCE taskOwner, SONRA applicants (clientId) fallback
      // Bu fonksiyon "indexed_documents" için çalışıyor; tipik olarak "clientId" mevcut.
      // Eğer dokümanda taskOwnerIds varsa önce onları kullan.
      const taskOwnerIds =
        (Array.isArray(newDocument.taskOwner) && newDocument.taskOwner) ||
        (Array.isArray(newDocument.taskOwnerIds) && newDocument.taskOwnerIds) ||
        [];

      if (taskOwnerIds.length > 0) {
        console.log("🎯 Öncelik: taskOwner -> personsRelated", taskOwnerIds);
        const fromOwners = await findRecipientsFromPersonsRelated(taskOwnerIds, categoryKey);
        toRecipients = fromOwners.to;
        ccRecipients = fromOwners.cc;
      }

      // Eğer taskOwner’dan alıcı çıkmadıysa → applicants (clientId) üzerinden dene
      const clientId = newDocument.clientId || null;
      if ((toRecipients.length + ccRecipients.length) === 0 && clientId) {
        console.log("↪️ taskOwner’dan alıcı çıkmadı; applicants (clientId) fallback deneniyor:", clientId);
        const fromApplicantsPR = await findRecipientsFromPersonsRelated([clientId], categoryKey);
        toRecipients = fromApplicantsPR.to;
        ccRecipients = fromApplicantsPR.cc;

        // Hâlâ yoksa getRecipientsByApplicantIds ile son kez dene
        if ((toRecipients.length + ccRecipients.length) === 0) {
          // Eğer ipRecord.applicants yoksa sentetik applicants [{id: clientId}]
          const rec = await getRecipientsByApplicantIds([{ id: clientId }], categoryKey);
          toRecipients = rec?.to || [];
          ccRecipients = rec?.cc || [];
        }
      }

      console.log("📧 FINAL RECIPIENTS", { toRecipients, ccRecipients });

      // 3) ŞABLON/İÇERİK — Şablon yoksa da boş bırakma (missing_info olmasın diye fallback oluştur)
      if (template) {
        subject = String(template.subject || "");
        body = String(template.body || "");

        const applicationNo =
          newDocument.applicationNumber ||
          newDocument.applicationNo ||
          newDocument.appNo ||
          "";

        const parameters = {
          ...newDocument,
          muvekkil_adi: newDocument.clientName || newDocument.ownerName || "Değerli Müvekkil",
          basvuru_no: applicationNo,
        };

        subject = subject.replace(/{{\s*([\w.]+)\s*}}/g, (_, k) => parameters[k] ?? "");
        body    = body.replace(/{{\s*([\w.]+)\s*}}/g, (_, k) => parameters[k] ?? "");
      } else {
        // Temel fallback içerik
        subject = `[${notificationType.toUpperCase()}] Yeni Evrak`;
        body = [
          `Merhaba,`,
          ``,
          `Sistemimize yeni bir evrak eklendi.`,
          `Evrak No / Başvuru No: ${newDocument.applicationNumber || newDocument.applicationNo || newDocument.appNo || "-"}`,
          ``,
          `Saygılarımızla`
        ].join("\n");
      }

      // 4) STATUS — SADE KURAL: sadece alıcı + içerik
      if (!subject?.trim()) missingFields.push("subject");
      if (!body?.trim())    missingFields.push("body");

      const hasRecipients = (toRecipients.length + ccRecipients.length) > 0;
      const hasContent    = !missingFields.includes("subject") && !missingFields.includes("body");
      const status        = (hasRecipients && hasContent) ? "pending" : "missing_info";

      if (!hasRecipients) missingFields.push("recipients");

      // 5) Firestore’a yaz — UI filtreleriyle uyumlu alanlar
      const selcanUserId = "Mkmq2sc0T6XTIg1weZyp5AGZ0YG3"; // <<< BURAYA SELCAN'IN GERÇEK ID'SİNİ YAPIŞTIRIN
      const selcanUserEmail = "selcanakoglu@evrekapatent.com"; // <<< BURAYA SELCAN'IN E-POSTA ADRESİNİ YAZIN

      const finalStatus = (hasRecipients && hasContent) ? "awaiting_client_approval" : "missing_info";
      if (!hasRecipients) missingFields.push("recipients");
      const notificationDoc = {
        toList: dedupe(toRecipients),
        ccList: dedupe(ccRecipients),

        clientId: newDocument.clientId || null,
        subject,
        body,
        status: finalStatus, // <<< DEĞİŞTİ
        mode: "draft",
        isDraft: true,

        assignedTo_uid: selcanUserId,         // <<< YENİ EKLENDİ
        assignedTo_email: selcanUserEmail,    // <<< YENİ EKLENDİ

        sourceDocumentId: docId,
        relatedIpRecordId: newDocument.relatedIpRecordId || null,
        associatedTaskId: null,
        associatedTransactionId: null,

        templateId: template ? (template.id || template.templateId || null) : null,
        notificationType,
        source: "document_index",
        missingFields,

        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
  
      console.log("📥 mail_notifications.add input:", {
        ...notificationDoc,
        createdAt: "[serverTimestamp]",
        updatedAt: "[serverTimestamp]",
      });

      const ref = await adminDb.collection("mail_notifications").add(notificationDoc);
      console.log(`✅ Mail bildirimi '${status}' olarak oluşturuldu.`, { id: ref.id });

      return null;
    } catch (error) {
      console.error("Mail bildirimi oluşturulurken hata:", error);
      return null;
    }
  }
);

export const createMailNotificationOnDocumentStatusChangeV2 = onDocumentUpdated(
    {
        document: "unindexed_pdfs/{docId}",
        region: 'europe-west1'
    },
    async (event) => {
        const change = event.data;
        if (!change || !change.before || !change.after) {
          console.error("Unexpected Firestore event shape for onDocumentUpdated.", {
            hasChange: !!change,
            hasBefore: !!change?.before,
            hasAfter: !!change?.after,
          });
          return null;
        }
        const before = change.before.data() || {};
        const after  = change.after.data()  || {};
        const docId = event.params.docId;

        if (before.status !== 'indexed' && after.status === 'indexed') {
            console.log(`Belge indexlendi: ${docId}`, after);

            let rule = null;
            let template = null;
            let client = null;
            let status = "pending"; // Varsayılan durum
            let subject = "";
            let body = "";
            let ipRecordData = null;
            let applicants = [];
            var foundTransactionType = null;
            
            const associatedTransactionId = after.associatedTransactionId;
            if (associatedTransactionId) {
                try {
                    const ipRecordsSnapshot = await adminDb.collection("ipRecords").get();            
                    for (const ipDoc of ipRecordsSnapshot.docs) {
                        const transactionRef = db.collection("ipRecords").doc(ipDoc.id).collection("transactions").doc(associatedTransactionId);
                        const transactionDoc = await transactionRef.get();
                        if (transactionDoc.exists) {
                            ipRecordData = ipDoc.data();
                            applicants = ipRecordData.applicants || [];
                            foundTransactionType = transactionDoc.data()?.type;
                            console.log(`✅ Transaction found in ipRecord: ${ipDoc.id}`);
                            break;
                        }
                    }
                    
                    if (ipRecordData) {
                        applicants = ipRecordData.applicants || [];
                        if (applicants.length > 0) {
                            const primaryApplicantId = applicants[0].id;
                            const clientSnapshot = await adminDb.collection("persons").doc(primaryApplicantId).get();
                            if (clientSnapshot.exists) {
                                client = clientSnapshot.data();
                            }
                        }
                    }
                } catch (error) {
                    console.error("Transaction sorgusu sırasında hata:", error);
                }
            }

            const notificationType = after.mainProcessType || 'marka';
            const recipients = await getRecipientsByApplicantIds(applicants, notificationType);
            const toRecipients = recipients.to || [];
            const ccRecipients = new Set(recipients.cc || []);

            if (foundTransactionType) {
              const extraCc = await getCcFromEvrekaListByTransactionType(foundTransactionType);
              for (const e of extraCc) { ccRecipients.add(e); }
            }

            if (toRecipients.length === 0 && Array.from(ccRecipients).length === 0) {
                status = "missing_info";
            }

            if (!client && after.clientId) {
                const clientSnapshot = await adminDb.collection("persons").doc(after.clientId).get();
                if (clientSnapshot.exists) {
                    client = clientSnapshot.data();
                }
            }

            const rulesSnapshot = await adminDb.collection("template_rules")
                .where("sourceType", "==", "document")
                .where("mainProcessType", "==", after.mainProcessType)
                .where("subProcessType", "==", after.subProcessType)
                .limit(1)
                .get();

            if (!rulesSnapshot.empty) {
                rule = rulesSnapshot.docs[0].data();
                const templateSnapshot = await adminDb.collection("mail_templates").doc(rule.templateId).get();
                if (templateSnapshot.exists) {
                    template = templateSnapshot.data();
                }
            }

            if (template && client) {
                subject = template.subject;
                body = template.body;
                const parameters = { ...client, ...after };
                for (const key in parameters) {
                    const placeholder = new RegExp(`{{${key}}}`, "g");
                    subject = subject.replace(placeholder, parameters[key]);
                    body = body.replace(placeholder, parameters[key]);
                }
            } else {
                subject = "Eksik Bilgi: Bildirim Tamamlanamadı";
                body = "Bu bildirim oluşturuldu ancak gönderim için eksik bilgiler mevcut.";
                status = "missing_info";
            }

            const missingFields = [];
            if (!client) missingFields.push('client');
            if (!template) missingFields.push('template');
            if (toRecipients.length === 0 && Array.from(ccRecipients).length === 0) missingFields.push('recipients');

            // === YENİ DURUM VE ATAMA MANTIĞI ===
            let finalStatus;
            if (missingFields.length > 0) {
                finalStatus = "missing_info";
            } else {
                finalStatus = "awaiting_client_approval"; // "pending" yerine bu durum kullanılır
            }

            const notificationData = {
                recipientTo: toRecipients,
                recipientCc: Array.from(ccRecipients),
                clientId: after.clientId || (applicants.length > 0 ? applicants[0].id : null),
                subject: subject,
                body: body,
                status: finalStatus, // GÜNCELLENDİ
                missingFields: missingFields,
                sourceDocumentId: docId,
                notificationType: notificationType,
                
                // --- OTOMATİK ATAMA EKLENDİ ---
                assignedTo_uid: DEFAULT_ASSIGNEE_UID,
                assignedTo_email: DEFAULT_ASSIGNEE_EMAIL,
                // ----------------------------------

                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            await adminDb.collection("mail_notifications").add(notificationData);
            console.log(`Mail bildirimi '${finalStatus}' olarak oluşturuldu ve ${DEFAULT_ASSIGNEE_EMAIL} kullanıcısına atandı.`);
            return null;

        } else {
            console.log("Status değişimi indekslenme değil, işlem atlandı.");
            return null;
        }
    }
);

export const createUniversalNotificationOnTaskCompleteV2 = onDocumentUpdated(
  {
    document: "tasks/{taskId}",
    region: "europe-west1",
  },
  async (event) => {
    const change = event.data;
    if (!change || !change.before || !change.after) return null;

    const before = change.before.data() || {};
    const after  = change.after.data() || {};
    const taskId = event.params.taskId;

    const becameCompleted = before.status !== "completed" && after.status === "completed";
    const epatsDoc = after?.details?.epatsDocument || null;
    if (!(becameCompleted && epatsDoc)) return null;

    const dedupe = (arr) => Array.from(new Set((arr || []).filter(Boolean).map((x) => String(x).trim())));
    const categoryKey = "marka";

    const findRecipientsFromPersonsRelated = async (personIds) => {
      const to = [], cc = [];
      if (!Array.isArray(personIds) || personIds.length === 0) return { to, cc };
      const chunks = [];
      for (let i = 0; i < personIds.length; i += 10) chunks.push(personIds.slice(i, i + 10));
      for (const chunk of chunks) {
        const prSnap = await adminDb.collection("personsRelated").where("personId", "in", chunk).get();
        prSnap.forEach((d) => {
          const pr = d.data();
          const email = (pr.email || "").trim();
          const isResp = pr?.responsible?.[categoryKey] === true;
          const n = pr?.notify?.[categoryKey] || {};
          if (email && isResp) {
            if (n?.to === true) to.push(email);
            if (n?.cc === true) cc.push(email);
          }
        });
      }
      return { to: dedupe(to), cc: dedupe(cc) };
    };

    const getRecipientsByApplicantIdsLocal = async (applicants) => {
      const ids = (Array.isArray(applicants) ? applicants : []).map(a => a?.id).filter(Boolean);
      return await findRecipientsFromPersonsRelated(ids);
    };

    let template = null, templateId = null, hasTemplate = false;
    try {
      const rulesSnap = await adminDb.collection("template_rules").where("sourceType", "==", "task_completion_epats").limit(1).get();
      if (!rulesSnap.empty) {
        const rule = rulesSnap.docs[0].data();
        templateId = rule?.templateId || null;
        if (templateId) {
          const tSnap = await adminDb.collection("mail_templates").doc(templateId).get();
          if (tSnap.exists) {
            template = tSnap.data();
            hasTemplate = true;
          }
        }
      }
    } catch (e) {
      console.warn("Template kuralı aranırken hata:", e?.message || e);
    }

    let ipRecord = null;
    if (after.relatedIpRecordId) {
      try {
        const ipSnap = await adminDb.collection("ipRecords").doc(after.relatedIpRecordId).get();
        if (ipSnap.exists) ipRecord = ipSnap.data();
      } catch (e) {
        console.warn("IP kaydı okunurken hata:", e?.message || e);
      }
    }

    const ownerIds = Array.isArray(after.taskOwner) ? after.taskOwner.filter(Boolean) : [];
    let toRecipients = [], ccRecipients = [], usedSource = null;

    if (ownerIds.length > 0) {
      usedSource = "taskOwner";
      const r = await findRecipientsFromPersonsRelated(ownerIds);
      toRecipients = r.to;
      ccRecipients = r.cc;
    } else {
      usedSource = "applicants_fallback";
      const r = await getRecipientsByApplicantIdsLocal(ipRecord?.applicants || []);
      toRecipients = r.to;
      ccRecipients = r.cc;
    }

    let txTypeForCc = null;
    try {
      const relatedIpId = after.relatedIpRecordId || null;
      const relatedTxId = after.relatedTransactionId || after.transactionId || null;
      if (relatedIpId && relatedTxId) {
        const txSnap = await adminDb.collection("ipRecords").doc(relatedIpId).collection("transactions").doc(relatedTxId).get();
        if (txSnap.exists) txTypeForCc = txSnap.data()?.type ?? null;
      }
      if (txTypeForCc == null && after.taskType != null) {
        txTypeForCc = after.taskType;
      }
      if (txTypeForCc != null) {
        const extra = await getCcFromEvrekaListByTransactionType(txTypeForCc);
        const allCcEmails = [...(ccRecipients || []), ...(extra || [])];
        ccRecipients = dedupe(allCcEmails);
      }
    } catch (e) {
      console.warn("CC listesi genişletilirken hata:", e?.message || e);
    }

    let subject = "", body = "";
    if (hasTemplate) {
      subject = String(template.subject || "");
      body    = String(template.body || "");
      const parameters = {
        muvekkil_adi: "Bilinmeyen Müvekkil",
        is_basligi: after.title || "",
        epats_evrak_no: epatsDoc?.turkpatentEvrakNo || epatsDoc?.evrakNo || "",
        basvuru_no: ipRecord?.applicationNumber || after?.relatedIpRecordTitle || "",
      };
      subject = subject.replace(/{{\s*([\w.]+)\s*}}/g, (_, k) => parameters[k] ?? "");
      body    = body.replace(/{{\s*([\w.]+)\s*}}/g, (_, k) => parameters[k] ?? "");
    }

    // === YENİ DURUM VE ATAMA MANTIĞI ===
    const coreMissing = [];
    if ((toRecipients.length + ccRecipients.length) === 0) coreMissing.push("recipients");
    if (!hasTemplate) coreMissing.push("mailTemplate");
    const finalStatus = coreMissing.length ? "missing_info" : "awaiting_client_approval";

    const epatsAttachment = {
      storagePath: epatsDoc?.storagePath || null,
      downloadURL: epatsDoc?.downloadURL || null,
      fileName:    epatsDoc?.name || "epats.pdf",
    };

    const notificationDoc = {
      toList: dedupe(toRecipients),
      ccList: dedupe(ccRecipients),
      subject,
      body,
      status: finalStatus, // GÜNCELLENDİ
      missingFields: coreMissing,
      mode: "draft",
      isDraft: true,

      // --- OTOMATİK ATAMA EKLENDİ ---
      assignedTo_uid: DEFAULT_ASSIGNEE_UID,
      assignedTo_email: DEFAULT_ASSIGNEE_EMAIL,
      // ----------------------------------

      relatedIpRecordId: after.relatedIpRecordId || null,
      associatedTaskId:  taskId,
      associatedTransactionId: after.relatedTransactionId || after.transactionId || null,
      templateId: templateId || null,
      notificationType: "marka",
      source: usedSource,
      epatsAttachment,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await adminDb.collection("mail_notifications").add(notificationDoc);
    console.log(`Bildirim '${finalStatus}' olarak oluşturuldu ve ${DEFAULT_ASSIGNEE_EMAIL} kullanıcısına atandı.`);

    return null;
  }
);

// =========================================================
//              STORAGE TRIGGER FONKSİYONLARI (v2)
// =========================================================

// Trademark Bulletin Upload Processing (v2 Storage Trigger)
// Debug edilmiş processTrademarkBulletinUploadV2 fonksiyonu
export const processTrademarkBulletinUploadV3 = onObjectFinalized(
  {
    region: "europe-west1",
    timeoutSeconds: 540,
    memory: "2GiB" // Bellek limiti artırıldı
  },
  async (event) => {
    const filePath = event.data.name || "";
    const fileName = path.basename(filePath);

    // Sadece bulletins/ altındaki ZIP dosyalarını işle
    if (!filePath.startsWith("bulletins/") || !fileName.toLowerCase().endsWith(".zip")) {
      return null; // log atma
    }

    console.log("🔥 Trademark Bulletin Upload V3 başladı:", filePath);

    const bucket = admin.storage().bucket();
    const tempFilePath = path.join(os.tmpdir(), fileName);
    const extractDir = path.join(os.tmpdir(), `extract_${Date.now()}`);

    try {
      // ZIP indir
      await downloadWithStream(bucket.file(filePath), tempFilePath);

      // ZIP aç
      fs.mkdirSync(extractDir, { recursive: true });
      await extractZipStreaming(tempFilePath, extractDir);

      // Dosyaları tara
      const allFiles = listAllFilesRecursive(extractDir);

      // bulletin.inf oku
      const bulletinFile = allFiles.find((p) =>
        ["bulletin.inf", "bulletin"].includes(path.basename(p).toLowerCase())
      );
      if (!bulletinFile) throw new Error("bulletin.inf bulunamadı.");

      const content = fs.readFileSync(bulletinFile, "utf8");
      const bulletinNo = (content.match(/NO\s*=\s*(.*)/) || [])[1]?.trim() || "Unknown";
      const bulletinDate = (content.match(/DATE\s*=\s*(.*)/) || [])[1]?.trim() || "Unknown";

      const bulletinRef = await adminDb.collection("trademarkBulletins").add({
        bulletinNo,
        bulletinDate,
        type: "marka",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      const bulletinId = bulletinRef.id;

      console.log(`📊 Bülten kaydedildi: ${bulletinNo} (${bulletinDate}) → ${bulletinId}`);

      // script parsing
      const scriptPath = allFiles.find(
        (p) => path.basename(p).toLowerCase() === "tmbulletin.log"
      );
      if (!scriptPath) throw new Error("tmbulletin.log bulunamadı.");

      const records = await parseScriptContentStreaming(scriptPath);

      // IMAGE PATH OLUŞTURMA
      const imagesDir = allFiles.filter((p) => p.includes(path.sep + "images" + path.sep));
      const imagePathMap = {};
      for (const imgPath of imagesDir) {
        const filename = path.basename(imgPath);
        const match = filename.match(/^(\d{4})[_\-]?(\d{5,})/);
        if (match) {
          const appNo = `${match[1]}/${match[2]}`;
          if (!imagePathMap[appNo]) imagePathMap[appNo] = [];
          imagePathMap[appNo].push(
            `bulletins/trademark_${bulletinNo}_images/${filename}`
          );
        }
      }

      // **CHUNK UPLOAD - Bellek dostu**
      const CHUNK_SIZE = 200; // Aynı anda en fazla 50 dosya
      for (let i = 0; i < imagesDir.length; i += CHUNK_SIZE) {
        const chunk = imagesDir.slice(i, i + CHUNK_SIZE);
        console.log(`📦 Görsel chunk yükleniyor: ${i + 1}-${i + chunk.length}/${imagesDir.length}`);

        await Promise.all(
          chunk.map((localPath) => {
            const destination = `bulletins/trademark_${bulletinNo}_images/${path.basename(localPath)}`;
            return bucket.upload(localPath, {
              destination,
              metadata: { contentType: getContentType(localPath) }
            });
          })
        );

        console.log(`✅ Chunk tamamlandı (${i + chunk.length}/${imagesDir.length})`);
        if (global.gc) {
          global.gc();
          console.log("🧹 Garbage collection tetiklendi (chunk sonrası)");
        }
      }

      console.log(`📷 ${imagesDir.length} görsel doğrudan yüklendi`);

      // Firestore kayıtları (imagePath eşleştirilmiş)
      await writeBatchesToFirestore(records, bulletinId, bulletinNo,imagePathMap);

      console.log(
        `🎉 ZIP işleme tamamlandı: ${bulletinNo} → ${records.length} kayıt, ${imagesDir.length} görsel bulundu.`
      );
    } catch (e) {
      console.error("❌ Hata:", e.message);
      throw e;
    } finally {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    }

    return null;
  }
);


// =========================================================
//              HELPER FONKSİYONLARI
// =========================================================

/**
 * IPRecord'daki applicants dizisindeki her kişi için e-posta alıcılarını belirler
 * @param {Array} applicants IPRecord'daki applicants dizisi
 * @param {string} notificationType Bildirim türü (örn: 'marka')
 * @returns {Promise<{to: string[], cc: string[]}>} Alıcı listeleri
 */
// Düzeltilmiş getRecipientsByApplicantIds fonksiyonu
async function getRecipientsByApplicantIds(applicants, notificationType = 'marka') {
  console.log("🚀 getRecipientsByApplicantIds başlatıldı");
  console.log("📋 Applicants:", applicants);
  console.log("🔍 Notification type:", notificationType);
  
  const typeKey = notificationType === 'trademark' ? 'marka' : notificationType;
  console.log("🗝️ Type key:", typeKey);
  
  const toRecipients = new Set();
  const ccRecipients = new Set();
  
  const addEmails = (set, val, label) => {
    const arr = Array.isArray(val) ? val :
      (typeof val === 'string' ? [val] : []);
    for (const e of arr.map(x => String(x).trim()).filter(Boolean)) {
      set.add(e);
      console.log(`📧 ${label} eklendi: ${e}`);
    }
  };

  if (!Array.isArray(applicants) || applicants.length === 0) {
    console.warn("❌ Applicants dizisi boş veya null");
    return { to: [], cc: [] };
  }

  // Applicant ID'lerini topla
  const applicantIds = applicants
    .map(a => a?.id || a?.personId)
    .filter(Boolean);
  
  console.log("📋 Applicant ID'leri:", applicantIds);

  if (applicantIds.length === 0) {
    console.warn("❌ Geçerli applicant ID'si bulunamadı");
    return { to: [], cc: [] };
  }

  try {
    // TÜM personsRelated kayıtlarını bul (applicant'lara ait olan)
    const prQuery = await adminDb.collection("personsRelated")
      .where("personId", "in", applicantIds)
      .get();

    console.log(`📊 Bulunan personsRelated kayıt sayısı: ${prQuery.docs.length}`);

    // Her personsRelated kaydını işle
    for (const prDoc of prQuery.docs) {
      const pr = prDoc.data() || {};
      const personId = pr.personId;
      
      console.log(`\n🔍 İşlenen personsRelated kaydı - PersonID: ${personId}`);
      console.log(`📄 Kayıt ID: ${prDoc.id}`);
      
      // Bu kişi bu notification type için responsible mı?
      const isResponsible = pr?.responsible?.[typeKey] === true;
      console.log(`🔍 responsible[${typeKey}] = ${String(isResponsible)}`);

      if (!isResponsible) {
        console.log(`❌ Person ${personId} sorumlu değil - '${typeKey}' için`);
        continue;
      }

      // Notify ayarlarını al
      const ns = pr?.notify?.[typeKey] || {};
      console.log(`🔎 notify[${typeKey}] =`, JSON.stringify(ns));

      // Email adresi al (personsRelated'deki email öncelikli, yoksa persons'dan)
      let personEmail = (pr.email || '').trim();
      
      if (!personEmail) {
        // persons koleksiyonundan email al
        try {
          const personSnap = await adminDb.collection("persons").doc(personId).get();
          if (personSnap.exists) {
            const person = personSnap.data() || {};
            personEmail = (person.email || '').trim();
            console.log(`✅ Person email bulundu: ${personEmail || '(yok)'}`);
          }
        } catch (err) {
          console.error(`❌ Person email alınamadı - ${personId}:`, err);
        }
      } else {
        console.log(`✅ PersonsRelated email kullanılıyor: ${personEmail}`);
      }

      // TO/CC ekleme işlemleri
      if (personEmail) {
        if (ns.to === true) { 
          toRecipients.add(personEmail);  
          console.log(`📧 TO (${prDoc.id}): ${personEmail}`); 
        }
        if (ns.cc === true) { 
          ccRecipients.add(personEmail);  
          console.log(`📧 CC (${prDoc.id}): ${personEmail}`); 
        }
      } else {
        if (ns.to === true || ns.cc === true) {
          console.warn(`⚠️ Email eksik - PersonID: ${personId}, Record: ${prDoc.id}`);
        }
      }

      // Ek email listelerini ekle
      addEmails(toRecipients, ns.toList,   `TO (${prDoc.id}-toList)`);
      addEmails(toRecipients, ns.toEmails, `TO (${prDoc.id}-toEmails)`);
      if (Array.isArray(ns.to)) addEmails(toRecipients, ns.to, `TO (${prDoc.id}-to[])`);

      addEmails(ccRecipients, ns.ccList,   `CC (${prDoc.id}-ccList)`);
      addEmails(ccRecipients, ns.ccEmails, `CC (${prDoc.id}-ccEmails)`);
      if (Array.isArray(ns.cc)) addEmails(ccRecipients, ns.cc, `CC (${prDoc.id}-cc[])`);

      // Opsiyonel: personsRelated.emails[typeKey]
      const prEmails = pr?.emails?.[typeKey] || {};
      addEmails(toRecipients, prEmails.to, `TO (${prDoc.id}-pr.emails)`);
      addEmails(ccRecipients, prEmails.cc, `CC (${prDoc.id}-pr.emails)`);
    }

  } catch (err) {
    console.error("❌ personsRelated sorgu hatası:", err);
  }

  const result = { to: Array.from(toRecipients), cc: Array.from(ccRecipients) };
  console.log("🎯 FINAL RESULT:");
  console.log("📧 TO recipients:", result.to);
  console.log("📧 CC recipients:", result.cc);
  console.log("📊 TO count:", result.to.length);
  console.log("📊 CC count:", result.cc.length);
  return result;
}

/**
 * evrekaMailCCList koleksiyonundan CC adreslerini getirir.
 * - transactionTypes === "All" olanların hepsi
 * - transactionTypes array-contains <txType> olanlar
 * @param {number|string} txType
 * @returns {Promise<string[]>}
 */
async function getCcFromEvrekaListByTransactionType(txType) {
  console.log("🔍 [EVREKA-CC] Fonksiyon çağrıldı:", { txType, type: typeof txType });
  
  const emails = new Set();

  try {
    // 1) transactionTypes array'inde number arama
    const n = typeof txType === "number" ? txType : parseInt(txType, 10);
    console.log("🔍 [EVREKA-CC] Parsed number:", { n, isValid: !Number.isNaN(n) });
    
    if (!Number.isNaN(n)) {
      const arrSnap = await adminDb.collection("evrekaMailCCList")
        .where("transactionTypes", "array-contains", n)
        .get();
      console.log(`🔍 [EVREKA-CC] Number query sonuç: ${arrSnap.size} docs`);
      
      arrSnap.forEach(d => {
        const e = (d.data()?.email || "").trim();
        console.log(`✅ [EVREKA-CC] Number match: ${d.id} -> ${e}`);
        if (e) emails.add(e);
      });
    }

    // 2) transactionTypes = "All" string değeri olanları ekle (== ile)
    const allSnap = await adminDb.collection("evrekaMailCCList")
      .where("transactionTypes", "==", "All")
      .get();
    console.log(`🔍 [EVREKA-CC] "All" query sonuç: ${allSnap.size} docs`);
    
    allSnap.forEach(d => {
      const e = (d.data()?.email || "").trim();
      console.log(`✅ [EVREKA-CC] "All" match: ${d.id} -> ${e}`);
      if (e) emails.add(e);
    });

    const result = Array.from(emails);
    console.log("🎯 [EVREKA-CC] Final result:", result);
    return result;
  } catch (err) {
    console.error("❌ [EVREKA-CC] evrekaMailCCList sorgu hatası:", err);
    return [];
  }
}
async function downloadWithStream(file, destination) {
  await pipeline(file.createReadStream(), fs.createWriteStream(destination));
}
async function extractZipStreaming(zipPath, extractDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const outputPath = path.join(extractDir, entry.entryName);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, zip.readFile(entry));
  }
}
function listAllFilesRecursive(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(listAllFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}
async function parseScriptContentStreaming(scriptPath) {
  const stats = fs.statSync(scriptPath);
  console.log(`📏 Script dosya boyutu: ${stats.size} bytes`);
  
  if (stats.size > 100 * 1024 * 1024) {
    console.log("🔄 Büyük dosya - chunk'lı parsing kullanılıyor");
    return parseScriptInChunks(scriptPath);
  }
  
  console.log("🔄 Normal parsing kullanılıyor");
  const content = fs.readFileSync(scriptPath, "utf8");
  return parseScriptContent(content);
}
function parseScriptContent(content) {
  console.log(`🔍 Parse başlıyor... Content length: ${content.length} karakter`);
  
  const recordsMap = {};
  const lines = content.split('\n');
  
  console.log(`📝 Toplam satır sayısı: ${lines.length}`);
  
  let processedLines = 0;
  let insertCount = 0;
  let valuesParsed = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line.length || !line.startsWith('INSERT INTO')) {
      continue;
    }
    
    processedLines++;
    insertCount++;
    
    if (processedLines % 1000 === 0) {
      console.log(`📈 İşlenen satır: ${processedLines}/${lines.length}`);
    }
    
    // ESKİ ÇALIŞAN REGEX PATTERN
    const match = line.match(/INSERT INTO (\w+) VALUES\s*\((.*)\)$/);
    if (!match) {
      if (insertCount <= 5) {
        console.warn(`⚠️ Regex eşleşmedi (satır ${i + 1}): ${line.substring(0, 100)}...`);
      }
      continue;
    }
    
    const table = match[1].toUpperCase();
    const valuesRaw = match[2];
    
    // MEVCUT parseValuesFromRaw FONKSİYONUNU KULLAN
    const values = parseValuesFromRaw(valuesRaw);
    
    if (!values || values.length === 0) {
      if (valuesParsed < 3) {
        console.warn(`⚠️ VALUES parse edilemedi: ${valuesRaw.substring(0, 50)}...`);
      }
      continue;
    }
    
    valuesParsed++;
    
    if (valuesParsed <= 3) {
      console.log(`✅ Parse başarılı (${table}):`, {
        appNo: values[0],
        totalValues: values.length,
        sample: values.slice(0, 3)
      });
    }
    
    const appNo = values[0];
    if (!appNo) continue;

    if (!recordsMap[appNo]) {
      recordsMap[appNo] = {
        applicationNo: appNo,
        applicationDate: null,
        markName: null,
        niceClasses: null,
        holders: [],
        goods: [],
        extractedGoods: [],
        attorneys: [],
      };
    }

    if (table === "TRADEMARK") {
      recordsMap[appNo].applicationDate = values[1] ?? null;
      recordsMap[appNo].markName = values[5] ?? null;
      recordsMap[appNo].niceClasses = values[6] ?? null;
    } else if (table === "HOLDER") {
      const holderName = extractHolderName(values[2]);
      let addressParts = [values[3], values[4], values[5], values[6]].filter(Boolean).join(", ");
      if (addressParts.trim() === "") addressParts = null;
      recordsMap[appNo].holders.push({
        name: holderName,
        address: addressParts,
        country: values[7] ?? null,
      });
    } else if (table === "GOODS") {
      recordsMap[appNo].goods.push(values[3] ?? null);
    } else if (table === "EXTRACTEDGOODS") {
      recordsMap[appNo].extractedGoods.push(values[3] ?? null);
    } else if (table === "ATTORNEY") {
      recordsMap[appNo].attorneys.push(values[2] ?? null);
    }
  }
  
  const result = Object.values(recordsMap);
  
  console.log(`✅ Parse tamamlandı:`, {
    totalLines: lines.length,
    processedLines: processedLines,
    insertCount: insertCount,
    valuesParsed: valuesParsed,
    uniqueApplications: result.length,
    successRate: insertCount > 0 ? ((valuesParsed / insertCount) * 100).toFixed(1) + '%' : '0%'
  });
  
  if (result.length > 0) {
    console.log(`📋 İlk kayıt örneği:`, JSON.stringify(result[0], null, 2));
  }
  
  return result;
}
function parseValuesFromRaw(raw) {
  const values = [];
  let current = "";
  let inString = false;
  let i = 0;

  while (i < raw.length) {
    const char = raw[i];
    if (char === "'") {
      if (inString && raw[i + 1] === "'") {
        current += "'";
        i += 2;
        continue;
      } else {
        inString = !inString;
      }
    } else if (char === "," && !inString) {
      values.push(decodeValue(current.trim()));
      current = "";
      i++;
      continue;
    } else {
      current += char;
    }
    i++;
  }
  
  if (current.trim()) {
    values.push(decodeValue(current.trim()));
  }
  
  return values;
}

async function parseScriptInChunks(scriptPath) {
  const fd = fs.openSync(scriptPath, "r");
  const fileSize = fs.statSync(scriptPath).size;
  const chunkSize = 1024 * 1024;
  let buffer = "";
  let position = 0;
  const records = {};
  let currentTable = null;
  while (position < fileSize) {
    const chunk = Buffer.alloc(Math.min(chunkSize, fileSize - position));
    fs.readSync(fd, chunk, 0, chunk.length, position);
    position += chunk.length;
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("INSERT INTO")) {
        const match = line.match(/INSERT INTO (\w+)/);
        currentTable = match ? match[1] : null;
      }
      if (currentTable && line.includes("VALUES")) {
        const values = parseValuesFromLine(line);
        if (!values || !values.length) continue;
        const appNo = values[0];
        if (!records[appNo]) {
          records[appNo] = {
            applicationNo: appNo,
            applicationDate: null,
            markName: null,
            niceClasses: null,
            holders: [],
            goods: [],
            extractedGoods: [],
            attorneys: []
          };
        }
        if (currentTable === "TRADEMARK") {
          records[appNo].applicationDate = values[1] || null;
          records[appNo].markName = values[4] || null;
          records[appNo].niceClasses = values[6] || null;
        } else if (currentTable === "HOLDER") {
          records[appNo].holders.push({
            name: extractHolderName(values[2]),
            address: values[3],
            country: values[4]
          });
        } else if (currentTable === "GOODS") {
          records[appNo].goods.push(values[3]);
        } else if (currentTable === "EXTRACTEDGOODS") {
          records[appNo].extractedGoods.push(values[3]);
        } else if (currentTable === "ATTORNEY") {
          records[appNo].attorneys.push(values[2]);
        }
      }
    }
  }
  fs.closeSync(fd);
  return Object.values(records);
}
function parseValuesFromLine(line) {
  const valuesMatch = line.match(/VALUES\s*\((.*)\)/i);
  if (!valuesMatch) return null;
  
  return parseValuesFromRaw(valuesMatch[1]);
}
function decodeValue(str) {
    if (str === null || str === undefined) return null;
    if (str === "") return null;
    str = str.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
    // \uXXXX formatındaki unicode karakterleri çöz
    return str.replace(/\\u([0-9a-fA-F]{4})/g,
        (m, g1) => String.fromCharCode(parseInt(g1, 16))
    );
}
function extractHolderName(str) {
  if (!str) return null;
  const parenMatch = str.match(/^\(\d+\)\s*(.*)$/);
  return parenMatch ? parenMatch[1].trim() : str.trim();
}
async function writeBatchesToFirestore(records, bulletinId, bulletinNo, imagePathMap) {
  const batchSize = 250;
  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    const batch = db.batch();
    chunk.forEach((record) => {
      record.bulletinId = bulletinId;
      record.bulletinNo = bulletinNo;
      const matchingImages = imagePathMap[record.applicationNo] || [];
      record.imagePath = matchingImages.length > 0 ? matchingImages[0] : null;
      record.imageUploaded = false;
      batch.set(db.collection("trademarkBulletinRecords").doc(), {
        ...record,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    console.log(`📝 ${Math.min(i + batchSize, records.length)}/${records.length} kayıt yazıldı`);
  }
}

function getContentType(filePath) {
  if (/\.png$/i.test(filePath)) return "image/png";
  if (/\.jpe?g$/i.test(filePath)) return "image/jpeg";
  return "application/octet-stream";
}

// BÜLTEN SİLME 
export const deleteBulletinV2 = onCall(
  { timeoutSeconds: 60, memory: "1GiB", region: "europe-west1" },
  async (request) => {
    try {
      const { bulletinId } = request.data || {};
      if (!bulletinId) {
        throw new HttpsError('invalid-argument', 'BulletinId gerekli.');
      }

      console.log(`🗑️ Silme işlemi başlatılıyor: ${bulletinId}`);

      const operationId = `delete_${bulletinId}_${Date.now()}`;
      const statusRef = db.collection('operationStatus').doc(operationId);
      
      // İlk durumu kaydet
      await statusRef.set({
        operationId,
        bulletinId,
        status: 'queued',
        message: 'Silme kuyruğa alındı...',
        progress: 0,
        startTime: admin.firestore.FieldValue.serverTimestamp(),
        userId: request.auth?.uid || null
      });

      console.log(`✅ Operation status created: ${operationId}`);

      // Topic oluştur/kontrol et
      try {
        await ensureTopic('bulletin-deletion');
        console.log('✅ Topic ensured: bulletin-deletion');
      } catch (topicError) {
        console.error('❌ Topic creation failed:', topicError);
        await statusRef.update({
          status: 'error',
          message: `Topic oluşturulamadı: ${topicError.message}`,
          endTime: admin.firestore.FieldValue.serverTimestamp()
        });
        throw new HttpsError('internal', `Topic oluşturulamadı: ${topicError.message}`);
      }

      // Pub/Sub mesajını yayınla
      try {
        const messageId = await pubsubClient.topic('bulletin-deletion').publishMessage({
          json: { bulletinId, operationId }
        });
        console.log(`✅ Pub/Sub message published: ${messageId}`);
        
        await statusRef.update({
          message: 'Mesaj kuyruğa gönderildi, işlem başlatılıyor...',
          progress: 5,
          pubsubMessageId: messageId
        });
        
      } catch (publishError) {
        console.error('❌ Pub/Sub publish failed:', publishError);
        await statusRef.update({
          status: 'error',
          message: `Mesaj gönderilemedi: ${publishError.message}`,
          endTime: admin.firestore.FieldValue.serverTimestamp()
        });
        throw new HttpsError('internal', `Mesaj gönderilemedi: ${publishError.message}`);
      }

      return { success: true, operationId, message: 'Silme işlemi kuyruğa alındı.' };
    } catch (error) {
      console.error('❌ deleteBulletinV2 error:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', String(error?.message || error));
    }
  }
);

// Gerçek silme işlemini yapan fonksiyon
async function performBulletinDeletion(bulletinId, operationId) {
  const statusRef = db.collection('operationStatus').doc(operationId);
  
  try {
    console.log(`🔥 Gerçek silme işlemi başladı: ${bulletinId}`);
    
    // === 1. Bülten dokümanını al ===
    const bulletinDoc = await db.collection('trademarkBulletins').doc(bulletinId).get();
    if (!bulletinDoc.exists) {
      throw new Error('Bülten bulunamadı.');
    }

    const bulletinData = bulletinDoc.data();
    const bulletinNo = bulletinData.bulletinNo;
    console.log(`📋 Silinecek bülten: ${bulletinNo}`);

    await statusRef.update({
      status: 'in_progress',
      message: `Bülten ${bulletinNo} kayıtları siliniyor...`,
      progress: 10
    });

    // === 2. İlişkili trademarkBulletinRecords silme (BulkWriter, hızlı) ===
    let totalRecordsDeleted = 0;

    // Sadece referans/id yeterli; network yükünü azaltmak için select() kullan
    const baseQuery = db.collection('trademarkBulletinRecords')
      .where('bulletinId', '==', bulletinId)
      .select();

    const writer = admin.firestore().bulkWriter({
      throttling: { initialOpsPerSecond: 500, maxOpsPerSecond: 2000 }
    });

    let lastDoc = null;
    while (true) {
      let q = baseQuery.limit(1000);
      if (lastDoc) q = q.startAfter(lastDoc);

      const snap = await q.get();
      if (snap.empty) break;

      for (const d of snap.docs) {
        writer.delete(d.ref);
      }
      totalRecordsDeleted += snap.size;
      lastDoc = snap.docs[snap.docs.length - 1];

      console.log(`✅ ${totalRecordsDeleted} kayıt silme kuyruğa alındı`);

      // İlerlemeyi güncelle (80'e kadar)
      await statusRef.update({
        message: `${totalRecordsDeleted} kayıt siliniyor...`,
        progress: Math.min(30 + Math.floor(totalRecordsDeleted / 100), 80)
      });
    }

    // Kuyruğun bitmesini bekle
    await writer.close();
    console.log(`✅ Toplam silinen kayıt: ${totalRecordsDeleted}`);

    await statusRef.update({
      message: 'Storage dosyaları siliniyor...',
      progress: 85
    });

  // === 3. Storage'dan görselleri sil (hızlı, toplu) ===
  let totalImagesDeleted = 0;
  try {
    const bucket = admin.storage().bucket();

    // Yükleme ile uyumlu gerçek klasör + geçmiş/yanlış path için ek prefix
    const prefixes = [
      `bulletins/trademark_${bulletinNo}_images/`,
      `trademark_images/${bulletinNo}/`
    ];

    for (const pfx of prefixes) {
      try {
        // Önce sayıyı ölç (log/istatistik için), sonra toplu sil
        const [files] = await bucket.getFiles({ prefix: pfx });
        if (files.length > 0) {
          console.log(`🖼️ ${pfx} altında ${files.length} dosya bulundu — toplu siliniyor...`);
          await bucket.deleteFiles({ prefix: pfx, force: true }); // ✅ çok daha hızlı
          totalImagesDeleted += files.length;
          console.log(`✅ ${pfx} temizlendi`);
        } else {
          console.log(`ℹ️ ${pfx} altında dosya yok`);
        }
      } catch (delErr) {
        console.warn(`⚠️ ${pfx} temizleme hatası:`, delErr?.message || delErr);
      }
    }
  } catch (storageError) {
    console.warn('⚠️ Storage silme hatası:', storageError?.message || storageError);
  }

  await statusRef.update({
    message: 'Ana bülten kaydı siliniyor...',
    progress: 95
  });

    // === 4. Ana bülten dokümanını sil ===
    await bulletinDoc.ref.delete();
    
    // === 5. Başarı durumunu güncelle ===
    await statusRef.update({
      status: 'completed',
      message: `Bülten ${bulletinNo} başarıyla silindi! Kayıtlar: ${totalRecordsDeleted}, Görseller: ${totalImagesDeleted}`,
      progress: 100,
      endTime: admin.firestore.FieldValue.serverTimestamp(),
      recordsDeleted: totalRecordsDeleted,
      imagesDeleted: totalImagesDeleted
    });

    console.log(`🎉 Bülten ${bulletinNo} başarıyla silindi!`);
    
  } catch (error) {
    console.error('❌ Silme işlemi hatası:', error);
    
    await statusRef.update({
      status: 'error',
      message: `Hata: ${error.message}`,
      endTime: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}

// Bu modüllerin functions/ altında da bulunması veya fonksiyon içine taşınması gerekecek.
// Şimdilik varsayımsal olarak import edeceğiz ve deployment sırasında düzenleme gerekebilir.
// Eğer bu helper dosyalarını (preprocess, visual-match, phonetic) functions klasörüne kopyalamazsanız,
// aşağıdaki import yollarını Node.js ortamına uygun olarak ayarlamanız veya bu kodları doğrudan bu dosya içine taşımanız gerekebilir.
// En temiz yöntem, bu helper'ları functions klasörünün altında ayrı bir utils veya helperlar klasörüne taşımaktır.
// Şimdilik fonksiyonun içine doğrudan kopyalayacağım ki ek dosya bağımlılığı olmasın.


// ======== Yardımcı Fonksiyonlar ve Algoritmalar (scorer.js, preprocess.js, visual-match.js, phonetic.js'ten kopyalandı) ========

// GENERIC_WORDS (preprocess.js'ten kopyalandı)
const GENERIC_WORDS = [// ======== ŞİRKET TİPLERİ ========
    'ltd', 'şti', 'aş', 'anonim', 'şirketi', 'şirket', 'limited', 'inc', 'corp', 'corporation', 'co', 'company', 'llc', 'group', 'grup',

    // ======== TİCARİ SEKTÖRLER ========
    'sanayi', 'ticaret', 'turizm', 'tekstil', 'gıda', 'inşaat', 'danışmanlık', 'hizmet', 'hizmetleri', 'bilişim', 'teknoloji', 'sigorta', 'yayıncılık', 'mobilya', 'otomotiv', 'tarım', 'enerji', 'petrol', 'kimya', 'kozmetik', 'ilaç', 'medikal', 'sağlık', 'eğitim', 'spor', 'müzik', 'film', 'medya', 'reklam', 'pazarlama', 'lojistik', 'nakliyat', 'kargo', 'finans', 'bankacılık', 'emlak', 'gayrimenkul', 'madencilik', 'metal', 'plastik', 'cam', 'seramik', 'ahşap',

    // ======== MESLEKİ TERİMLER ========
    'mühendislik', 'proje', 'taahhüt', 'ithalat', 'ihracat', 'üretim', 'imalat', 'veteriner', 'petshop', 'polikliniği', 'hastane', 'klinik', 'müşavirlik', 'muhasebe', 'hukuk', 'avukatlık', 'mimarlık', 'peyzaj', 'tasarım', 'dizayn', 'design', 'grafik', 'web', 'yazılım', 'software', 'donanım', 'hardware', 'elektronik', 'elektrik', 'makina', 'makine', 'endüstri', 'fabrika', 'laboratuvar', 'araştırma', 'geliştirme', 'ofis', // 'ofis' eklendi

    // ======== ÜRÜN/HİZMET TERİMLERİ ========
    'ürün', // 'ürün' kökü eklendi (ürünleri, ürünler gibi varyasyonları kapsayacak)
    'products', 'services', 'solutions', 'çözüm', // 'çözümleri' yerine 'çözüm' kökü
    'sistem', 'systems', 'teknolojileri', 'teknoloji', // 'teknolojileri' yanına 'teknoloji'
    'malzeme', 'materials', 'ekipman', 'equipment', 'cihaz', 'device', 'araç', 'tools', 'yedek', 'parça', 'parts', 'aksesuar', 'accessories', 'gereç', 'malzeme',

    // ======== GENEL MARKALAŞMA TERİMLERİ ========
    'meşhur', 'ünlü', 'famous', 'since', 'est', 'established', 'tarihi', 'historical', 'geleneksel', 'traditional', 'klasik', 'classic', 'yeni', 'new', 'fresh', 'taze', 'özel', 'special', 'premium', 'lüks', 'luxury', 'kalite', // 'kalite' eklendi
    'quality', 'uygun', // 'uygun' eklendi

    // ======== LOKASYON TERİMLERİ ========
    'turkey', 'türkiye', 'international', 'uluslararası',

    // ======== EMLAK TERİMLERİ ========
    'realestate', 'emlak', 'konut', 'housing', 'arsa', 'ticari', 'commercial', 'ofis', 'office', 'plaza', 'shopping', 'alışveriş', 'residence', 'rezidans', 'villa', 'apartment', 'daire',

    // ======== DİJİTAL TERİMLERİ ========
    'online', 'digital', 'dijital', 'internet', 'web', 'app', 'mobile', 'mobil', 'network', 'ağ', 'server', 'sunucu', 'hosting', 'domain', 'platform', 'social', 'sosyal', 'media', 'medya',

    // ======== GIDA TERİMLERİ ========
    'gıda', 'food', 'yemek', 'restaurant', 'restoran', 'cafe', 'kahve', 'coffee', 'çay', 'tea', 'fırın', 'bakery', 'ekmek', 'bread', 'pasta', 'börek', 'pizza', 'burger', 'kebap', 'döner', 'pide', 'lahmacun', 'balık', 'fish', 'et', 'meat', 'tavuk', 'chicken', 'sebze', 'vegetable', 'meyve', 'fruit', 'süt', 'milk', 'peynir', 'cheese', 'yoğurt', 'yogurt', 'dondurma', 'şeker', 'sugar', 'bal', 'reçel', 'jam', 'konserve', 'canned', 'organic', 'organik', 'doğal', 'natural', 'taze', 'fresh',

    // ======== BAĞLAÇLAR ve Yaygın Kelimeler ========
    've', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'ki', 'mi', 'mı', 'mu', 'mü',
    'sadece', 'tek', 'en', 'çok', 'az', 'üst', 'alt', 'yeni', 'eski'
];

function removeTurkishSuffixes(word) {
    if (!word) return '';
    
    // Çoğul ekleri: -ler, -lar
    if (word.endsWith('ler') || word.endsWith('lar')) {
        return word.substring(0, word.length - 3);
    }
    // İyelik ekleri (basit formlar): -im, -in, -i, -ımız, -ınız, -ları
    // Örneğin, 'ofisi' -> 'ofis'
    if (word.endsWith('si') || word.endsWith('sı') || word.endsWith('sü') || word.endsWith('su')) {
        return word.substring(0, word.length - 2);
    }
    if (word.endsWith('i') || word.endsWith('ı') || word.endsWith('u') || word.endsWith('ü')) {
        // 'gıda' gibi kelimelerde 'ı' son ek olmamalı, bu yüzden dikkatli olmalı
        // Daha güvenli bir kontrol için kelime kökü kontrol edilebilir
        // Şimdilik sadece iyelik ve yönelme eklerini çıkarıyoruz.
        // Basitçe son harfi kaldırmak riskli, ama şimdilik en yaygın olanları ele alalım
        if (word.length > 2 && ['i', 'ı', 'u', 'ü'].includes(word[word.length - 1])) {
             // 'ofis' gibi kelimelerde 'i' iyelik eki olabilir.
             // Daha sofistike bir çözüm için NLP kütüphanesi gerekir, bu basit bir yaklaşımdır.
             return word.substring(0, word.length - 1);
        }
    }
    // Fiilimsiler, durum ekleri vb. için daha karmaşık kurallar gerekebilir
    
    return word;
}

/**
 * Marka adını temizler: küçük harfe çevirir, özel karakterleri kaldırır, stopwords'ü çıkarır.
 *
 * @param {string} name Marka adı
 * @param {boolean} removeGenericWords Stopwords'ün çıkarılıp çıkarılmayacağını belirler.
 * Genellikle çok kelimeli isimler için true olmalı.
 * @returns {string} Temizlenmiş marka adı.
 */
export function cleanMarkName(name, removeGenericWords = true) {
    if (!name) return '';
    let cleaned = name.toLowerCase().replace(/[^a-z0-9ğüşöçı\s]/g, '').trim(); // Harf, rakam ve boşluk dışındaki her şeyi kaldır

    // Birden fazla boşluğu tek boşluğa indirge
    cleaned = cleaned.replace(/\s+/g, ' ');

    if (removeGenericWords) {
        // Kelimelere ayır, eklerini kaldır ve stopwords olmayanları filtrele
        cleaned = cleaned.split(' ').filter(word => {
            const stemmedWord = removeTurkishSuffixes(word);
            // Kök kelime veya orijinal kelime stopwords listesinde mi kontrol et
            return !GENERIC_WORDS.includes(stemmedWord) && !GENERIC_WORDS.includes(word);
        }).join(' ');
    }

    return cleaned.trim();
}

// visual-match.js'ten kopyalandı
const visualMap = {
    "a": ["e", "o"], "b": ["d", "p"], "c": ["ç", "s"], "ç": ["c", "s"], "d": ["b", "p"], "e": ["a", "o"], "f": ["t"],
    "g": ["ğ", "q"], "ğ": ["g", "q"], "h": ["n"], "i": ["l", "j", "ı"], "ı": ["i"], "j": ["i", "y"], "k": ["q", "x"],
    "l": ["i", "1"], "m": ["n"], "n": ["m", "r"], "o": ["a", "0", "ö"], "ö": ["o"], "p": ["b", "q"], "q": ["g", "k"],
    "r": ["n"], "s": ["ş", "c", "z"], "ş": ["s", "z"], "t": ["f"], "u": ["ü", "v"], "ü": ["u", "v"], "v": ["u", "ü", "w"],
    "w": ["v"], "x": ["ks"], "y": ["j"], "z": ["s", "ş"], "0": ["o"], "1": ["l", "i"], "ks": ["x"], "Q": ["O","0"],
    "O": ["Q", "0"], "I": ["l", "1"], "L": ["I", "1"], "Z": ["2"], "S": ["5"], "B": ["8"], "D": ["O"]
};

function visualMismatchPenalty(a, b) {
    if (!a || !b) return 5; 

    const lenDiff = Math.abs(a.length - b.length);
    const minLen = Math.min(a.length, b.length);
    let penalty = lenDiff * 0.5;

    for (let i = 0; i < minLen; i++) {
        const ca = a[i].toLowerCase();
        const cb = b[i].toLowerCase();

        if (ca !== cb) {
            if (visualMap[ca] && visualMap[ca].includes(cb)) {
                penalty += 0.25;
            } else {
                penalty += 1.0;
            }
        }
    }
    return penalty;
}

// phonetic.js'ten kopyalandı
function normalizeString(str) {
    if (!str) return "";
    return str
        .toLowerCase()
        .replace(/[^a-z0-9ğüşöçı]/g, '')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/ı/g, 'i');
}

function isPhoneticallySimilar(a, b) {
    if (!a || !b) return 0.0;

    a = normalizeString(a);
    b = normalizeString(b);

    if (a === b) return 1.0;

    const lenA = a.length;
    const lenB = b.length;
    const minLen = Math.min(lenA, lenB);
    const maxLen = Math.max(lenA, lenB);

    if (maxLen === 0) return 1.0;
    if (maxLen > 0 && minLen === 0) return 0.0;

    const lengthMismatchPenalty = Math.abs(lenA - lenB) / maxLen;
    let score = 1.0 - lengthMismatchPenalty;

    let matchingChars = 0;
    const matchedA = new Array(lenA).fill(false);
    const matchedB = new Array(lenB).fill(false);

    const searchRange = Math.min(maxLen, Math.floor(maxLen / 2) + 1);
    for (let i = 0; i < lenA; i++) {
        for (let j = Math.max(0, i - searchRange); j < Math.min(lenB, i + searchRange + 1); j++) {
            if (a[i] === b[j] && !matchedB[j]) {
                matchingChars++;
                matchedA[i] = true;
                matchedB[j] = true;
                break;
            }
        }
    }

    if (matchingChars === 0) return 0.0;

    const commonality = matchingChars / Math.max(lenA, lenB);
    
    let positionalBonus = 0;
    if (lenA > 0 && lenB > 0) {
        if (a[0] === b[0]) positionalBonus += 0.2;
        if (lenA > 1 && lenB > 1 && a[1] === b[1]) positionalBonus += 0.1;
    }

    score = (commonality * 0.7) + (positionalBonus * 0.3);

    return Math.max(0.0, Math.min(1.0, score));
}
function parseDate(value) {
  if (!value) return null;
  
  // dd/MM/yyyy formatı desteği (Türkiye standartı)
  const parts = value.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // 0-indexed
    const year = parseInt(parts[2], 10);
    
    // Geçerlilik kontrolü ekleyin
    if (day > 0 && day <= 31 && month >= 0 && month <= 11 && year > 1900) {
      return new Date(year, month, day);
    }
  }
  
  // ISO formatı veya başka formatlar için
  const isoDate = new Date(value);
  return isNaN(isoDate) ? null : isoDate;
}

function isValidBasedOnDate(hitDate, monitoredDate) {
  if (!hitDate || !monitoredDate) return true;

  const hit = parseDate(hitDate);
  const monitored = parseDate(monitoredDate);

  if (!hit || !monitored || isNaN(hit) || isNaN(monitored)) return true;

  // doğru mantık
  return hit >= monitored;
}

// functions/index.js - Düzeltilmiş nice sınıf fonksiyonu

function hasOverlappingNiceClasses(monitoredTrademark, bulletinRecordNiceClasses) {
  logger.log("🏷️ Nice sınıf karşılaştırması:", {
    monitoredTrademarkId: monitoredTrademark.id,
    monitoredNiceClassSearch: monitoredTrademark.niceClassSearch,
    bulletinRecordNiceClasses,
    bulletinRecordType: typeof bulletinRecordNiceClasses
  });
  
  try {
    // İzlenen markadan niceClassSearch array'ini al
    const monitoredNiceClassSearch = monitoredTrademark.niceClassSearch || [];
    
    // Eğer izlenen markanın niceClassSearch'u yoksa, sınıf filtresini atla
    if (!Array.isArray(monitoredNiceClassSearch) || monitoredNiceClassSearch.length === 0) {
      logger.log("ℹ️ İzlenen markanın niceClassSearch'u yok, filtre atlanıyor");
      return true;
    }
    
    // Bülten kaydında nice sınıf yoksa çakışma yok
    if (!bulletinRecordNiceClasses) {
      logger.log("ℹ️ Bülten kaydında nice sınıf yok, çakışma yok");
      return false;
    }

    // Nice sınıfları normalize et (sadece rakamları al ve array'e çevir)
    const normalizeNiceClasses = (classes) => {
      if (!classes) return [];
      
      let classArray = [];
      
      if (Array.isArray(classes)) {
        classArray = classes;
      } else if (typeof classes === 'string') {
        // String ise önce " / " ile böl, sonra diğer ayırıcılarla da böl
        classArray = classes.split(/[\s\/,]+/).filter(c => c.trim());
      } else {
        classArray = [String(classes)];
      }
      
      // Her sınıftan sadece rakamları al
      return classArray
        .map(cls => String(cls).replace(/\D/g, '')) // Sadece rakamları al
        .filter(cls => cls && cls.length > 0); // Boş olanları çıkar
    };
    
    const monitoredClasses = normalizeNiceClasses(monitoredNiceClassSearch);
    const bulletinRecordClasses = normalizeNiceClasses(bulletinRecordNiceClasses);
    
    logger.log("🔧 Normalize edilmiş sınıflar:", {
      monitoredClasses: monitoredClasses,
      bulletinRecordClasses: bulletinRecordClasses
    });
    
    // Bülten kaydı sınıfları boşsa çakışma yok
    if (bulletinRecordClasses.length === 0) {
      logger.log("ℹ️ Bülten kaydı sınıfları boş, çakışma yok");
      return false;
    }
    
    // Kesişim kontrolü
    const hasOverlap = monitoredClasses.some(monitoredClass => 
      bulletinRecordClasses.some(bulletinClass => monitoredClass === bulletinClass)
    );
    
    logger.log(`🏷️ Nice sınıf kesişimi: ${hasOverlap ? 'VAR' : 'YOK'}`);
    
    // Debug: hangi sınıflar eşleşti?
    if (hasOverlap) {
      const matchingClasses = monitoredClasses.filter(monitoredClass => 
        bulletinRecordClasses.some(bulletinClass => monitoredClass === bulletinClass)
      );
      logger.log(`✅ Eşleşen sınıflar: ${matchingClasses.join(', ')}`);
    }
    
    return hasOverlap;
    
  } catch (error) {
    logger.error('❌ Nice class karşılaştırma hatası:', error);
    return false;
  }
}

// ======== Ana Benzerlik Skorlama Fonksiyonu (scorer.js'ten kopyalandı) ========
function levenshteinDistance(a, b) {
  const matrix = [];

  const lenA = a.length;
  const lenB = b.length;

  for (let i = 0; i <= lenB; i++) matrix[i] = [i];
  for (let j = 0; j <= lenA; j++) matrix[0][j] = j;

  for (let i = 1; i <= lenB; i++) {
    for (let j = 1; j <= lenA; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[lenB][lenA];
}

function levenshteinSimilarity(a, b) {
  if (!a || !b) return 0;
  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : (1 - distance / maxLen);
}

function calculateSimilarityScoreInternal(hitMarkName, searchMarkName, hitApplicationDate, searchApplicationDate, hitNiceClasses, searchNiceClasses) {
    // Jenerik ibare temizliği
    const isSearchMultiWord = searchMarkName.trim().split(/\s+/).length > 1;
    const isHitMultiWord = (hitMarkName || '').trim().split(/\s+/).length > 1;

    const cleanedSearchName = cleanMarkName(searchMarkName || '', isSearchMultiWord).toLowerCase().trim();
    const cleanedHitName = cleanMarkName(hitMarkName || '', isHitMultiWord).toLowerCase().trim();

    logger.log(`📊 Skorlama: '${searchMarkName}' (temizlenmiş: '${cleanedSearchName}') vs '${hitMarkName}' (temizlenmiş: '${cleanedHitName}')`);

    if (!cleanedSearchName || !cleanedHitName) {
        return { finalScore: 0.0, positionalExactMatchScore: 0.0 }; // Her iki skoru da döndür
    }

    // Tam eşleşme kontrolü (en yüksek öncelik)
    if (cleanedSearchName === cleanedHitName) {
        return { finalScore: 1.0, positionalExactMatchScore: 1.0 }; // Her iki skoru da döndür
    }

    // ======== Alt Benzerlik Skorları ========
    const levenshteinScore = (() => {
        const matrix = [];
        if (cleanedSearchName.length === 0) return cleanedHitName.length === 0 ? 1.0 : 0.0;
        if (cleanedHitName.length === 0) return cleanedSearchName.length === 0 ? 1.0 : 0.0;
    
        for (let i = 0; i <= cleanedHitName.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= cleanedSearchName.length; j++) {
            matrix[0][j] = j;
        }
    
        for (let i = 1; i <= cleanedHitName.length; i++) {
            for (let j = 1; j <= cleanedSearchName.length; j++) {
                const cost = cleanedHitName.charAt(i - 1) === cleanedSearchName.charAt(j - 1) ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + cost, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
        const maxLength = Math.max(cleanedSearchName.length, cleanedHitName.length);
        return maxLength === 0 ? 1.0 : 1.0 - (matrix[cleanedHitName.length][cleanedSearchName.length] / maxLength);
    })();
    logger.log(`   - Levenshtein Score: ${levenshteinScore.toFixed(2)}`);

    const jaroWinklerScore = (() => {
        const s1 = cleanedSearchName;
        const s2 = cleanedHitName;
        if (s1 === s2) return 1.0;

        let m = 0;
        const s1_len = s1.length;
        const s2_len = s2.length;

        const range = Math.floor(Math.max(s1_len, s2_len) / 2) - 1;
        const s1_matches = new Array(s1_len);
        const s2_matches = new Array(s2_len);

        for (let i = 0; i < s1_len; i++) {
            const char_s1 = s1[i];
            for (let j = Math.max(0, i - range); j < Math.min(s2_len, i + range + 1); j++) {
                if (char_s1 === s2[j] && !s2_matches[j]) {
                    s1_matches[i] = true;
                    s2_matches[j] = true;
                    m++;
                    break;
                }
            }
        }

        if (m === 0) return 0.0;

        let k = 0;
        let t = 0;
        for (let i = 0; i < s1_len; i++) {
            if (s1_matches[i]) {
                let j;
                for (j = k; j < s2_len; j++) {
                    if (s2_matches[j]) {
                        k = j + 1;
                        break;
                    }
                }
                if (s1[i] !== s2[j]) {
                    t++;
                }
            }
        }
        t = t / 2;

        const jaro_score = (m / s1_len + m / s2_len + (m - t) / m) / 3;

        const p = 0.1;
        let l = 0;
        const max_prefix_len = 4;

        for (let i = 0; i < Math.min(s1_len, s2_len, max_prefix_len); i++) {
            if (s1[i] === s2[i]) {
                l++;
            } else {
                break;
            }
        }

        return jaro_score + l * p * (1 - jaro_score);
    })();
    logger.log(`   - Jaro-Winkler Score: ${jaroWinklerScore.toFixed(2)}`);

    const ngramScore = (() => {
        const s1 = cleanedSearchName;
        const s2 = cleanedHitName;
        const n = 2;
        if (!s1 || !s2) return 0.0;
        if (s1 === s2) return 1.0;

        const getNGrams = (s, num) => {
            const ngrams = new Set();
            for (let i = 0; i <= s.length - num; i++) {
                ngrams.add(s.substring(i, i + num));
            }
            return ngrams;
        };

        const ngrams1 = getNGrams(s1, n);
        const ngrams2 = getNGrams(s2, n);

        if (ngrams1.size === 0 && ngrams2.size === 0) return 1.0;
        if (ngrams1.size === 0 || ngrams2.size === 0) return 0.0;

        let common = 0;
        ngrams1.forEach(ngram => {
            if (ngrams2.has(ngram)) {
                common++;
            }
        });

        return common / Math.min(ngrams1.size, ngrams2.size);
    })();
    logger.log(`   - N-gram Score (n=2): ${ngramScore.toFixed(2)}`);

    const visualScore = (() => {
        const visualPenalty = visualMismatchPenalty(cleanedSearchName, cleanedHitName);
        const maxPossibleVisualPenalty = Math.max(cleanedSearchName.length, cleanedHitName.length) * 1.0;
        return maxPossibleVisualPenalty === 0 ? 1.0 : (1.0 - (visualPenalty / maxPossibleVisualPenalty));
    })();
    logger.log(`   - Visual Score: ${visualScore.toFixed(2)}`);

    const prefixScore = (() => {
        const s1 = cleanedSearchName;
        const s2 = cleanedHitName;
        const length = 3;
        if (!s1 || !s2) return 0.0;
        const prefix1 = s1.substring(0, Math.min(s1.length, length));
        const prefix2 = s2.substring(0, Math.min(s2.length, length));

        if (prefix1 === prefix2) return 1.0;
        if (prefix1.length === 0 && prefix2.length === 0) return 1.0;

        return levenshteinSimilarity(prefix1, prefix2); // Önek karşılaştırması için levenshteinSimilarity kullan
    })();
    logger.log(`   - Prefix Score (len 3): ${prefixScore.toFixed(2)}`);

    // 6. Kelime Bazında En Yüksek Benzerlik Skoru + Eşleşen Kelime Çifti
    const { maxWordScore, maxWordPair } = (() => {
        const s1 = cleanedSearchName;
        const s2 = cleanedHitName;
        if (!s1 || !s2) return { maxWordScore: 0.0, maxWordPair: null };

        const words1 = s1.split(' ').filter(w => w.length > 0);
        const words2 = s2.split(' ').filter(w => w.length > 0);

        if (words1.length === 0 && words2.length === 0) return { maxWordScore: 1.0, maxWordPair: null };
        if (words1.length === 0 || words2.length === 0) return { maxWordScore: 0.0, maxWordPair: null };

        let maxSim = 0.0;
        let pair = null;
        for (const w1 of words1) {
            for (const w2 of words2) {
                const sim = levenshteinSimilarity(w1, w2);
                if (sim > maxSim) {
                    maxSim = sim;
                    pair = [w1, w2];
                }
            }
        }
        return { maxWordScore: maxSim, maxWordPair: pair };
    })();

    logger.log(`   - Max Word Score: ${maxWordScore.toFixed(2)}`);

    // Yeni: Konumsal Tam Eşleşme Skoru (örn: ilk 3 karakter tam eşleşiyorsa)
    const positionalExactMatchScore = (() => {
        const s1 = cleanedSearchName;
        const s2 = cleanedHitName;
        if (!s1 || !s2) return 0.0;

        // İlk 3 karakteri büyük/küçük harf duyarsız karşılaştır
        const len = Math.min(s1.length, s2.length, 3);
        if (len === 0) return 0.0; // Karşılaştırılacak karakter yok

        // Tüm karakterleri kontrol et - HEPSİ eşleşmeli
        for (let i = 0; i < len; i++) {
            if (s1[i] !== s2[i]) {  // ✅ DÜZELTME: Farklı karakter bulduğunda
                return 0.0;          // ✅ DÜZELTME: 0.0 döndür ve çık
            }
        }
        return 1.0; // ✅ DÜZELTME: Sadece TÜM karakterler eşleşirse 1.0 döndür
    })();
    logger.log(`   - Positional Exact Match Score (first 3 chars): ${positionalExactMatchScore.toFixed(2)}`);

    // ======== YENİ KURAL: Yüksek Kelime Benzerliği Kontrolü ve Önceliklendirme ========

    const HIGH_WORD_SIMILARITY_THRESHOLD = 0.70;

    // Eşleşen en iyi kelime çifti tam eşleşmeyse uzunluğunu kontrol et
    const exactWordLen =
        (maxWordPair && maxWordPair[0] === maxWordPair[1]) ? maxWordPair[0].length : 0;

    if (maxWordScore >= HIGH_WORD_SIMILARITY_THRESHOLD) {
        // Eğer tam kelime eşleşmesi ile 1.0 elde edildiyse ve bu kelime 2 karakterden kısaysa
        // erken dönüşü engelle (tek harfli "a" gibi durumlar %100 yapmasın)
        if (maxWordScore === 1.0 && exactWordLen < 2) {
            logger.log(`   *** Tam kelime eşleşmesi tek/çok kısa kelime ile (len=${exactWordLen}) bulundu; erken dönüş iptal edildi. ***`);
            // Erken dönme, alttaki karma skorlamaya devam
        } else {
            logger.log(`   *** Yüksek kelime bazında benzerlik tespit edildi (maxWordScore=${(maxWordScore*100).toFixed(0)}%). Erken dönüş uygulanıyor. ***`);
            return { finalScore: maxWordScore, positionalExactMatchScore: positionalExactMatchScore };
        }
    }
    
    // ======== İsim Benzerliği Alt Toplamı Hesaplama (%95 Ağırlık) ========
    const nameSimilarityRaw = (
        levenshteinScore * 0.30 +
        jaroWinklerScore * 0.25 +
        ngramScore * 0.15 +
        visualScore * 0.15 +
        prefixScore * 0.10 +
        maxWordScore * 0.05
    );

    const nameSimilarityWeighted = nameSimilarityRaw * 0.95;
    logger.log(`   - Name Similarity (weighted 95%): ${nameSimilarityWeighted.toFixed(2)}`);

    // ======== Fonetik Benzerlik Skoru (%5 Ağırlık) ========
    const phoneticScoreRaw = isPhoneticallySimilar(searchMarkName, hitMarkName);
    const phoneticSimilarityWeighted = phoneticScoreRaw * 0.05;
    logger.log(`   - Phonetic Score (weighted 5%): ${phoneticSimilarityWeighted.toFixed(2)}`);

    // ======== Genel Benzerlik Skoru ========
    let finalScore = nameSimilarityWeighted + phoneticSimilarityWeighted;

    finalScore = Math.max(0.0, Math.min(1.0, finalScore));

    logger.log(`   - FINAL SCORE: ${finalScore.toFixed(2)}\n`);
    return { finalScore: finalScore, positionalExactMatchScore: positionalExactMatchScore }; // Her iki skoru da döndür
}

// ======== Yeni Cloud Function: Sunucu Tarafında Marka Benzerliği Araması ========
// functions/index.js - performTrademarkSimilaritySearch fonksiyonunun düzeltilmiş kısmı

// functions/index.js (sadece performTrademarkSimilaritySearch fonksiyonu güncellenmiştir)

export const performTrademarkSimilaritySearch = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 300,
    memory: '1GiB'
  },
  async (request) => {
    const { monitoredMarks, selectedBulletinId } = request.data;

    if (!Array.isArray(monitoredMarks) || monitoredMarks.length === 0 || !selectedBulletinId) {
      throw new HttpsError(
        'invalid-argument',
        'Missing required parameters: monitoredMarks (array) or selectedBulletinId'
      );
    }

    logger.log('🚀 Cloud Function: performTrademarkSimilaritySearch BAŞLATILDI', {
      numMonitoredMarks: monitoredMarks.length,
      selectedBulletinId,
      monitoredMarksDetails: monitoredMarks.map(m => ({ id: m.id, markName: m.markName }))
    });

    try {
      let bulletinRecordsSnapshot;

      // Önce bulletinId olarak direkt ara
      bulletinRecordsSnapshot = await adminDb.collection('trademarkBulletinRecords')
        .where('bulletinId', '==', selectedBulletinId)
        .get();

      // Eğer sonuç yoksa veya gönderilen değer "469_27052025" gibi ise → bulletinNo ile ara
      if (!bulletinRecordsSnapshot || bulletinRecordsSnapshot.empty) {
        // "_" içeriyorsa sadece ilk kısmı al
        let selectedBulletinNo = selectedBulletinId;
        if (selectedBulletinId.includes('_')) {
          selectedBulletinNo = selectedBulletinId.split('_')[0];
        }

        const bulletinDoc = await adminDb.collection('trademarkBulletins')
          .where('bulletinNo', '==', selectedBulletinNo)
          .limit(1)
          .get();

        if (!bulletinDoc.empty) {
          const bulletinIdFromNo = bulletinDoc.docs[0].id;
          bulletinRecordsSnapshot = await adminDb.collection('trademarkBulletinRecords')
            .where('bulletinId', '==', bulletinIdFromNo)
            .get();
        }
      }

      const bulletinRecords = bulletinRecordsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      logger.log(`✅ ${bulletinRecords.length} kayıt bulundu.`);

      const allResults = [];

      for (const monitoredMark of monitoredMarks) {
        logger.log("🔍 İşlenen monitored mark:", {
          id: monitoredMark.id,
          markName: monitoredMark.markName,
          applicationDate: monitoredMark.applicationDate,
          niceClasses: monitoredMark.niceClasses
        });

        const markNameRaw = monitoredMark.markName || monitoredMark.title || '';
        const markName = (typeof markNameRaw === 'string') ? markNameRaw.trim() : '';
        const applicationDate = monitoredMark.applicationDate || null;
        const niceClasses = monitoredMark.niceClasses || [];

        if (!markName) {
          logger.warn(`⚠️ İzlenen markanın adı eksik:`, monitoredMark);
          continue;
        }

        // Aranan markanın temizlenmiş hali (burada tanımlanması gerekiyor)
        const cleanedSearchName = cleanMarkName(markName, markName.trim().split(/\s+/).length > 1); // cleanMarkName fonksiyonuna erişilebilir olmalı

        logger.log(`🔎 Arama: '${markName}' (ID: ${monitoredMark.id})`);

        let matchCount = 0;

        for (const hit of bulletinRecords) {
          // Tarih filtresi
          if (!isValidBasedOnDate(hit.applicationDate, applicationDate)) {
            continue;
          }

          // Nice sınıf filtresi - AKTIF
          const hasNiceClassOverlap = hasOverlappingNiceClasses(monitoredMark, hit.niceClasses);

          // Eğer Nice sınıf kesişimi yoksa atla
          // NOTE: Previously skipped when no Nice class overlap.
// if (!hasNiceClassOverlap) { continue; }

          // Benzerlik skoru
          const { finalScore: similarityScore, positionalExactMatchScore } = calculateSimilarityScoreInternal(
            hit.markName,
            markName,
            hit.applicationDate,
            applicationDate,
            hit.niceClasses,
            niceClasses
          );

          const SIMILARITY_THRESHOLD = 0.5; //

          // Yeni Kriter Kontrolü: Aranan marka, bulunan markanın başında veya sonunda tam geçiyor mu?
        const cleanedHitName = cleanMarkName(hit.markName, (hit.markName || '').trim().split(/\s+/).length > 1);
        let isPrefixSuffixExactMatch = false;

        // Minimum uzunluk kontrolü eklendi, çok kısa kelimelerin eşleşmesi anlamsız olabilir.
        const MIN_SEARCH_LENGTH = 3; // En az 3 karakterlik bir eşleşme arıyoruz

        if (cleanedSearchName.length >= MIN_SEARCH_LENGTH) {
            // Aranan markanın tüm kelimelerini kontrol et
            const searchWords = cleanedSearchName.split(' ').filter(word => word.length >= MIN_SEARCH_LENGTH);
            
            for (const searchWord of searchWords) {
                // Bulunan markanın temizlenmiş halinde aranan kelime geçiyor mu?
                if (cleanedHitName.includes(searchWord)) {
                    isPrefixSuffixExactMatch = true;
                    logger.log(`🎯 Tam eşleşme bulundu: '${searchWord}' kelimesi '${cleanedHitName}' içinde geçiyor`);
                    break; // Bir eşleşme bulmak yeterli
                }
            }
            
            // Alternatif olarak: Aranan markanın tamamı bulunan markada geçiyor mu?
            // (kelime kelime değil, bütün olarak)
            if (!isPrefixSuffixExactMatch && cleanedHitName.includes(cleanedSearchName)) {
                isPrefixSuffixExactMatch = true;
                logger.log(`🎯 Tam eşleşme bulundu: '${cleanedSearchName}' tamamı '${cleanedHitName}' içinde geçiyor`);
            }
        }
          // GÜNCELLENMİŞ FİLTRELEME KOŞULU

          if (
              similarityScore < SIMILARITY_THRESHOLD && 
              positionalExactMatchScore < SIMILARITY_THRESHOLD && 
              !isPrefixSuffixExactMatch
          ) {
            // Hiçbir geçerli kriteri sağlamadı, bu yüzden atla
            logger.log(`⏩ Atlandı: Final Skor: ${similarityScore.toFixed(2)}, Positional: ${positionalExactMatchScore.toFixed(2)}, Prefix/Suffix Eşleşme Yok - ${hit.markName}`);
            continue;
          }

          // Bu noktaya ulaşan tüm kayıtlar, yukarıdaki üç 'continue' koşulundan en az birini karşılamadığı için eklenir.
          // Yani, ya similarityScore >= THRESHOLD, ya positionalExactMatchScore >= THRESHOLD, ya da isPrefixSuffixExactMatch === true.
          matchCount++;

          // *** ÖNEMLİ: Tüm gerekli alanları ekle ***
          
// Compute 'isEarlier' (hit earlier than monitored application date)
let isEarlier = false;
try {
  const searchDate = applicationDate ? new Date(applicationDate) : null;
  const hitDate = hit.applicationDate ? new Date(hit.applicationDate) : null;
  if (searchDate && hitDate) {
    isEarlier = hitDate.getTime() < searchDate.getTime();
  }
} catch (e) {
  isEarlier = false;
}
allResults.push({
            objectID: hit.id,
            markName: hit.markName,
            applicationNo: hit.applicationNo,
            applicationDate: hit.applicationDate,
            niceClasses: hit.niceClasses,
            holders: hit.holders,
            imagePath: hit.imagePath,
            bulletinId: hit.bulletinId,
            similarityScore,
            positionalExactMatchScore,
            sameClass: hasNiceClassOverlap, // Şu anda true olarak ayarlı
            
            // *** FRONTEND İÇİN GEREKLİ ALANLAR ***
            monitoredTrademark: markName, // Frontend'in eşleştirme için kullandığı alan
            monitoredNiceClasses: monitoredMark.niceClassSearch || [],
            monitoredTrademarkId: monitoredMark.id, // Eski uyumluluk için
            isEarlier: isEarlier
});
        }

        logger.log(`📊 '${markName}' (ID: ${monitoredMark.id}) için ${matchCount} eşleşme bulundu`);
      }

      allResults.sort((a, b) => b.similarityScore - a.similarityScore);
      
      // *** SON KONTROL LOGU ***
      logger.log(`✅ Toplam ${allResults.length} sonuç döndürülüyor`, {
        sampleResult: allResults[0] ? {
          markName: allResults[0].markName,
          monitoredTrademark: allResults[0].monitoredTrademark,
          monitoredMarkId: allResults[0].monitoredMarkId,
          monitoredTrademarkId: allResults[0].monitoredTrademarkId
        } : 'No results'
      });

      return { success: true, results: allResults };
    } catch (error) {
      logger.error('❌ Cloud Function hata:', error);
      throw new HttpsError('internal', 'Marka benzerliği araması sırasında hata oluştu.', error.message);
    }
  }
);
const bucket = admin.storage().bucket();
export const generateSimilarityReport = onCall(
  {
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "europe-west1"
  },
  async (request) => {
    try {
      const { results } = request.data;
      if (!results || !Array.isArray(results)) {
        throw new Error("Geçersiz veri formatı");
      }

      // --- Sahip bazında grupla ---
      const owners = {};
      results.forEach((m) => {
        const owner = (m.monitoredMark && m.monitoredMark.ownerName) || "Bilinmeyen Sahip";
        if (!owners[owner]) owners[owner] = [];
        owners[owner].push(m);
      });

      const archive = archiver("zip", { zlib: { level: 9 } });
      const passthrough = new stream.PassThrough();
      archive.pipe(passthrough);

      // Her sahip için ayrı dosya oluştur
      for (const [ownerName, matches] of Object.entries(owners)) {
        const doc = await createProfessionalReport(ownerName, matches);
        const buffer = await Packer.toBuffer(doc);
        archive.append(buffer, { name: `${sanitizeFileName(ownerName)}_Benzerlik_Raporu.docx` });
      }

      await archive.finalize();
      const chunks = [];
      for await (const chunk of passthrough) chunks.push(chunk);
      const finalBuffer = Buffer.concat(chunks);

      return {
        success: true,
        file: finalBuffer.toString("base64")
      };
    } catch (error) {
      console.error("Rapor oluşturma hatası:", error);
      return { success: false, error: error.message };
    }
  }
);

// Ana rapor oluşturma fonksiyonu
async function createProfessionalReport(ownerName, matches) {
  // --- Benzer marka bazında grupla ---
  const grouped = {};
  matches.forEach((m) => {
    const key = (m.similarMark && m.similarMark.applicationNo) || 'unknown';
    if (!grouped[key]) {
      grouped[key] = { 
        similarMark: m.similarMark || {}, 
        monitoredMarks: [] 
      };
    }
    grouped[key].monitoredMarks.push(m.monitoredMark || {});
  });

  const reportContent = [];

  // === RAPOR BAŞLIĞI ===
  reportContent.push(...createReportHeader(ownerName, matches.length));
  
  // === ÖZ BİLGİLER ===
  reportContent.push(...createExecutiveSummary(grouped));
  
  // === SAYFA KESME ===
  reportContent.push(new Paragraph({ 
    children: [new PageBreak()]
  }));

  // === DETAY ANALİZ ===
  for (const [index, group] of Object.entries(grouped).entries()) {
    if (index > 0) {
      reportContent.push(new Paragraph({ 
        children: [new PageBreak()]
      }));
    }
    
    const [_, g] = group;
    reportContent.push(...createDetailedAnalysisSection(g, index + 1));
  }

  // === SONUÇ VE ÖNERİLER ===
  reportContent.push(new Paragraph({ 
    children: [new PageBreak()]
  }));
  reportContent.push(...createConclusionSection(grouped));

  return new Document({
    creator: "IP Manager",
    description: `${ownerName} Marka Benzerlik Raporu`,
    title: `Marka Benzerlik Raporu`,
    sections: [{
      properties: {},
      children: reportContent
    }]
  });
}

// === RAPOR BAŞLIĞI ===
function createReportHeader(ownerName, totalMatches) {
  const currentDate = new Date().toLocaleDateString('tr-TR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return [
    // Ana başlık
    new Paragraph({
      children: [
        new TextRun({
          text: "MARKA BENZERLİK ANALİZİ RAPORU",
          bold: true,
          size: 32,
          color: "2E4BC7"
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 }
    }),

    // Alt başlık
    new Paragraph({
      children: [
        new TextRun({
          text: `${ownerName} İçin Detaylı İnceleme`,
          bold: true,
          size: 24,
          color: "666666"
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 }
    }),

    // Rapor bilgileri tablosu
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            createInfoCell("Rapor Tarihi:", currentDate),
            createInfoCell("Toplam Tespit:", `${totalMatches} adet benzer marka`)
          ]
        }),
        new TableRow({
          children: [
            createInfoCell("Analiz Kapsamı:", "Marka benzerlik tespiti"),
            createInfoCell("Rapor Durumu:", "Tamamlandı")
          ]
        })
      ]
    }),

    new Paragraph({ text: "", spacing: { after: 600 } })
  ];
}

// === ÖZ BİLGİLER BÖLÜMÜ ===
function createExecutiveSummary(grouped) {
  const totalSimilarMarks = Object.keys(grouped).length;
  const totalMonitoredMarks = Object.values(grouped).reduce((sum, g) => sum + g.monitoredMarks.length, 0);
  
  // Risk seviyesi analizi
  let highRisk = 0, mediumRisk = 0, lowRisk = 0;
  Object.values(grouped).forEach(g => {
    const similarity = parseFloat(g.similarMark.similarity) || 0;
    if (similarity >= 70) highRisk++;
    else if (similarity >= 50) mediumRisk++;
    else lowRisk++;
  });

  return [
    new Paragraph({
      children: [
        new TextRun({
          text: "YÖNETİCİ ÖZETİ",
          bold: true,
          size: 20,
          color: "2E4BC7"
        })
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 300 }
    }),

    new Paragraph({
      children: [
        new TextRun({
          text: "Bu rapor, izlenen markalarınıza yönelik benzerlik analizi sonuçlarını içermektedir. ",
          size: 22
        }),
        new TextRun({
          text: "Aşağıdaki önemli bulgular tespit edilmiştir:",
          size: 22,
          bold: true
        })
      ],
      spacing: { after: 300 }
    }),

    // Özet istatistikler tablosu
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            createSummaryHeaderCell("Analiz Konusu"),
            createSummaryHeaderCell("Sonuç"),
            createSummaryHeaderCell("Değerlendirme")
          ]
        }),
        new TableRow({
          children: [
            createSummaryCell("Benzer Marka Sayısı"),
            createSummaryCell(`${totalSimilarMarks} adet`),
            createSummaryCell(totalSimilarMarks > 5 ? "Yüksek" : totalSimilarMarks > 2 ? "Orta" : "Düşük")
          ]
        }),
        new TableRow({
          children: [
            createSummaryCell("İzlenen Marka Sayısı"),
            createSummaryCell(`${totalMonitoredMarks} adet`),
            createSummaryCell("Aktif İzleme")
          ]
        }),
        new TableRow({
          children: [
            createSummaryCell("Yüksek Risk (≥%70)"),
            createSummaryCell(`${highRisk} adet`),
            createSummaryCell(highRisk > 0 ? "Acil İnceleme Gerekli" : "Risk Yok")
          ]
        }),
        new TableRow({
          children: [
            createSummaryCell("Orta Risk (%50-69)"),
            createSummaryCell(`${mediumRisk} adet`),
            createSummaryCell(mediumRisk > 0 ? "İzleme Gerekli" : "Risk Yok")
          ]
        }),
        new TableRow({
          children: [
            createSummaryCell("Düşük Risk (<50%)"),
            createSummaryCell(`${lowRisk} adet`),
            createSummaryCell("Düşük Öncelik")
          ]
        })
      ]
    })
  ];
}

// === DETAYLI ANALİZ BÖLÜMÜ ===
function createDetailedAnalysisSection(group, sectionIndex) {
  const elements = [];
  const similarMark = group.similarMark;
  const similarity = parseFloat(similarMark.similarity) || 0;
  
  // Risk seviyesi belirleme
  let riskLevel = "DÜŞÜK";
  let riskColor = "28A745";
  if (similarity >= 70) {
    riskLevel = "YÜKSEK";
    riskColor = "DC3545";
  } else if (similarity >= 50) {
    riskLevel = "ORTA";
    riskColor = "FFC107";
  }

  // Bölüm başlığı
  elements.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${sectionIndex}. BENZER MARKA ANALİZİ`,
          bold: true,
          size: 18,
          color: "2E4BC7"
        })
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 300 }
    })
  );

  // Benzer marka bilgi kartı
  elements.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "🎯 BENZER MARKA BİLGİLERİ",
                      bold: true,
                      size: 32,
                      color: "FFFFFF"
                    })
                  ],
                  alignment: AlignmentType.CENTER
                })
              ],
              columnSpan: 2,
              shading: { fill: "2E4BC7", type: "clear", color: "auto" }
            })
          ]
        }),
        new TableRow({
          children: [
            createDetailCell("Marka Adı:", similarMark.name || "-"),
            createDetailCell("Başvuru No:", similarMark.applicationNo || "-")
          ]
        }),
        new TableRow({
          children: [
            createDetailCell("Başvuru Tarihi:", similarMark.date || "-"),
            createDetailCell("Nice Sınıfları:", Array.isArray(similarMark.niceClass) ? 
              similarMark.niceClass.join(", ") : (similarMark.niceClass || "-"))
          ]
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "Benzerlik Oranı: ",
                      bold: true
                    }),
                    new TextRun({
                      text: `%${similarity.toFixed(1)}`,
                      bold: true,
                      color: riskColor,
                      size: 24
                    })
                  ]
                })
              ]
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "Risk Seviyesi: ",
                      bold: true
                    }),
                    new TextRun({
                      text: riskLevel,
                      bold: true,
                      color: riskColor,
                      size: 24
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]
    })
  );

  elements.push(new Paragraph({ text: "", spacing: { after: 300 } }));

  // İzlenen markalar tablosu
  elements.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "🔍 İZLENEN MARKALAR",
          bold: true,
          size: 16,
          color: "2E4BC7"
        })
      ],
      spacing: { before: 300, after: 200 }
    })
  );

  const monitoredTableRows = [
    new TableRow({
      children: [
        createTableHeaderCell("Marka Adı"),
        createTableHeaderCell("Başvuru No"),
        createTableHeaderCell("Başvuru Tarihi"),
        createTableHeaderCell("Nice Sınıfları"),
        createTableHeaderCell("Durum")
      ]
    })
  ];

  group.monitoredMarks.forEach(mark => {
    monitoredTableRows.push(
      new TableRow({
        children: [
          createTableDataCell(mark.markName || mark.name || "-"),
          createTableDataCell(mark.applicationNo || "-"),
          createTableDataCell(mark.date || mark.applicationDate || "-"),
          createTableDataCell(Array.isArray(mark.niceClass) ? 
            mark.niceClass.join(", ") : (mark.niceClass || mark.niceClasses || "-")),
          createTableDataCell("Aktif İzleme")
        ]
      })
    );
  });

  elements.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: monitoredTableRows
    })
  );

  // Not alanı varsa ekle
  if (similarMark.note && similarMark.note.trim()) {
    elements.push(
      new Paragraph({ text: "", spacing: { after: 300 } }),
      new Paragraph({
        children: [
          new TextRun({
            text: "📝 NOTLAR",
            bold: true,
            size: 14,
            color: "2E4BC7"
          })
        ],
        spacing: { after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: similarMark.note,
            italics: true,
            size: 22
          })
        ],
        spacing: { before: 100, after: 300 }
      })
    );
  }

  return elements;
}

// === SONUÇ VE ÖNERİLER ===
function createConclusionSection(grouped) {
  const totalMarks = Object.keys(grouped).length;
  const highRiskMarks = Object.values(grouped).filter(g => 
    parseFloat(g.similarMark.similarity) >= 70).length;

  return [
    new Paragraph({
      children: [
        new TextRun({
          text: "SONUÇ VE ÖNERİLER",
          bold: true,
          size: 20,
          color: "2E4BC7"
        })
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 300 }
    }),

    new Paragraph({
      children: [
        new TextRun({
          text: `Bu analiz kapsamında toplam ${totalMarks} adet benzer marka tespit edilmiştir. `,
          size: 22
        }),
        new TextRun({
          text: `Bunlardan ${highRiskMarks} adedi yüksek risk kategorisindedir.`,
          size: 22,
          bold: true,
          color: highRiskMarks > 0 ? "DC3545" : "28A745"
        })
      ],
      spacing: { after: 300 }
    }),

    new Paragraph({
      children: [
        new TextRun({
          text: "📋 ÖNERİLER:",
          bold: true,
          size: 16,
          color: "2E4BC7"
        })
      ],
      spacing: { before: 300, after: 200 }
    }),

    ...(highRiskMarks > 0 ? [
      new Paragraph({
        children: [
          new TextRun({ text: "🔴 ", size: 20 }),
          new TextRun({
            text: "Yüksek riskli markalar için acil hukuki inceleme yapılması önerilir.",
            size: 22,
            bold: true
          })
        ],
        spacing: { after: 150 }
      })
    ] : []),

    new Paragraph({
      children: [
        new TextRun({ text: "📊 ", size: 20 }),
        new TextRun({
          text: "Nice sınıf çakışmalarının detaylı analiz edilmesi",
          size: 22
        })
      ],
      spacing: { after: 150 }
    }),

    new Paragraph({
      children: [
        new TextRun({ text: "⚖️ ", size: 20 }),
        new TextRun({
          text: "Gerekli durumlarda itiraz prosedürlerinin başlatılması",
          size: 22
        })
      ],
      spacing: { after: 150 }
    }),

    new Paragraph({
      children: [
        new TextRun({ text: "🔍 ", size: 20 }),
        new TextRun({
          text: "Düzenli izleme sürecinin devam ettirilmesi",
          size: 22
        })
      ],
      spacing: { after: 400 }
    }),

    // Rapor footer
    new Paragraph({
      children: [
        new TextRun({
          text: "Bu rapor IP Manager - Marka Analiz Sistemi tarafından otomatik olarak oluşturulmuştur.",
          size: 18,
          italics: true,
          color: "666666"
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 600 }
    })
  ];
}

// === YARDIMCI FONKSİYONLAR ===

function createInfoCell(label, value) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: label, bold: true }),
          new TextRun({ text: ` ${value}` })
        ]
      })
    ],
    width: { size: 50, type: WidthType.PERCENTAGE }
  });
}

function createSummaryHeaderCell(text) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: text,
            bold: true,
            color: "FFFFFF",
            size: 24
          })
        ],
        alignment: AlignmentType.CENTER
      })
    ],
    shading: { fill: "2E4BC7", type: "clear", color: "auto" }
  });
}

function createSummaryCell(text) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: text, size: 22 })],
        alignment: AlignmentType.CENTER
      })
    ],
    shading: { fill: "F8F9FA", type: "clear", color: "auto" }
  });
}

function createDetailCell(label, value) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: label, bold: true, size: 22 }),
          new TextRun({ text: ` ${value}`, size: 22 })
        ]
      })
    ],
    width: { size: 50, type: WidthType.PERCENTAGE },
    shading: { fill: "F8F9FA", type: "clear", color: "auto" }
  });
}

function createTableHeaderCell(text) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: text,
            bold: true,
            color: "FFFFFF",
            size: 24
          })
        ],
        alignment: AlignmentType.CENTER
      })
    ],
    shading: { fill: "495057", type: "clear", color: "auto" }
  });
}

function createTableDataCell(text) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || "-", size: 22 })]
      })
    ]
  });
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
}

// KULLANICI VE ADMIN YÖNETİMİ //

const strip = (s) => String(s ?? '').trim().replace(/^["'\s]+|["'\s]+$/g, '');

function canManageUsers(req) {
  console.log('🔍 Auth debug:', {
    hasAuth: !!req.auth,
    uid: req.auth?.uid,
    email: req.auth?.token?.email,
    role: req.auth?.token?.role,
    allClaims: req.auth?.token
  });
  
  if (!req.auth) return false;
  
  // Normal kontroller
  const claims = req.auth.token;
  const role = claims?.role;
  const email = claims?.email;
  const uid = req.auth.uid;
  
  // 1. Süper admin claim kontrolü
  if (role === 'superadmin') {
    console.log('✅ Access granted via superadmin role');
    return true;
  }
  
  // 2. Specific UID kontrolü (backup)
  if (uid === 'wH6MFM3jrYShxWDPkjr0Lbuj61F2') {
    console.log('✅ Access granted via specific UID');
    return true;
  }
  
  // 3. E-posta kontrolü (backup)
  if (email && email.includes('@evrekapatent.com')) {
    console.log('✅ Access granted via company email');
    return true;
  }
  
  console.log('❌ Access denied');
  return false;
}

// === Kullanıcı Oluştur/Güncelle (Auth + Firestore senkron) ===
export const adminUpsertUser = onCall({ region: "europe-west1" }, async (req) => {
  if (!canManageUsers(req)) {
    throw new HttpsError("permission-denied", "Yetkisiz istek.");
  }

  const uidInput      = strip(req.data?.uid);
  const emailInput    = strip(req.data?.email).toLowerCase();
  const newEmailInput = strip(req.data?.newEmail).toLowerCase();   // opsiyonel
  const displayName   = strip(req.data?.displayName);
  console.log('🔍 Backend received:', { 
    displayName, 
    emailInput,
    hasDisplayName: !!displayName 
});
  const role          = strip(req.data?.role || "user");
  const password      = String(req.data?.password || "");          // opsiyonel
  const disabledFlag  = req.data?.disabled;                         // opsiyonel (true/false)

  if (!uidInput && !emailInput) {
    throw new HttpsError("invalid-argument", "uid veya email zorunlu.");
  }
  if (!displayName) {
    throw new HttpsError("invalid-argument", "displayName zorunlu.");
  }

  // 1) Kullanıcıyı bul (uid veya email) — yoksa oluştur
  let userRecord;
  let existed = true;
  try {
    userRecord = uidInput
      ? await adminAuth.getUser(uidInput)
      : await adminAuth.getUserByEmail(emailInput);
  } catch (e) {
    if (e?.code === "auth/user-not-found") {
      existed = false;
    } else {
      throw new HttpsError("internal", `Kullanıcı sorgulanamadı: ${e?.message || e}`);
    }
  }

  if (!existed) {
    const createParams = { email: emailInput, displayName };
    if (password) createParams.password = password;
    userRecord = await adminAuth.createUser(createParams);
  }

  // 2) Güncelleme parametreleri
  const updateParams = {};
  if (displayName && displayName !== userRecord.displayName) updateParams.displayName = displayName;
  if (typeof disabledFlag === "boolean" && disabledFlag !== userRecord.disabled) updateParams.disabled = disabledFlag;
  if (password) updateParams.password = password;

  // E-posta değişikliği (çakışma kontrolü ile)
  const targetEmail = newEmailInput || emailInput || userRecord.email || "";
  if (targetEmail && targetEmail !== userRecord.email) {
    try {
      const other = await adminAuth.getUserByEmail(targetEmail);
      if (other.uid !== userRecord.uid) {
        throw new HttpsError("already-exists", "Bu e-posta başka bir kullanıcıda kayıtlı.");
      }
    } catch (e) {
      if (e?.code !== "auth/user-not-found") {
        throw new HttpsError("internal", `E-posta kontrolü başarısız: ${e?.message || e}`);
      }
      // user-not-found ise hedef e-posta kullanılabilir demektir
    }
    updateParams.email = targetEmail;
  }

  // 3) Auth güncelle
  if (Object.keys(updateParams).length) {
    userRecord = await adminAuth.updateUser(userRecord.uid, updateParams);
  }

  // 4) Custom claims (rol)
  if (role) {
    await adminAuth.setCustomUserClaims(userRecord.uid, { role });
  }

  // 5) Firestore profilini upsert et
  await adminDb.collection("users").doc(userRecord.uid).set(
    {
      email: userRecord.email,
      displayName: userRecord.displayName || displayName,
      role,
      disabled: !!userRecord.disabled,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existed ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );

  return {
    uid: userRecord.uid,
    email: userRecord.email,
    existed,
    role,
    disabled: !!userRecord.disabled,
  };
});

export const onAuthUserCreate = auth.user().onCreate(async (user) => {
  // Email'den ad çıkar veya varsayılan kullan
  const displayName = user.displayName || 
                      user.email?.split('@')[0]?.replace(/[._-]/g, ' ') || 
                      'Yeni Kullanıcı';
  
  console.log(`🆔 Creating user profile: ${user.uid}, email: ${user.email}, displayName: "${displayName}"`);
  
  // 1. Firestore'a kaydet
  await adminDb.collection('users').doc(user.uid).set({
    email: user.email || '',
    displayName: displayName,
    role: 'belirsiz',
    disabled: !!user.disabled,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    _source: 'auth.user().onCreate'
  }, { merge: true });
  
  // 2. Custom claim olarak da "belirsiz" rolü ata
  await adminAuth.setCustomUserClaims(user.uid, { role: 'belirsiz' });
  
  console.log(`✅ User profile created successfully for ${user.uid} with role: belirsiz`);
});

export const onAuthUserDelete = auth.user().onDelete(async (user) => {
  await adminDb.collection('users').doc(user.uid).delete().catch(() => {});
});


export const adminDeleteUser = onCall({ region: "europe-west1" }, async (req) => {
  if (!canManageUsers(req)) {
    throw new HttpsError("permission-denied", "Yetkisiz istek.");
  }

  const uid = strip(req.data?.uid);
  if (!uid) throw new HttpsError("invalid-argument", "uid zorunlu.");

  const callerUid = req.auth?.uid;
  if (uid === callerUid) {
    throw new HttpsError("failed-precondition", "Kendi hesabınızı silemezsiniz.");
  }

  // 1) Auth'tan sil – hataları kontrollü map et
  try {
    await adminAuth.deleteUser(uid);
  } catch (e) {
    if (e?.code === "auth/user-not-found") {
      // Auth'ta yoksa bile Firestore'u temizleyip OK dönelim
      await adminDb.collection("users").doc(uid).delete().catch(() => {});
      return { ok: true, uid, note: "auth user not found; firestore cleaned" };
    }
    throw new HttpsError("internal", "Auth delete failed: " + (e?.message || e));
  }

  // 2) Firestore profilini sil (yoksa sorun değil)
  await adminDb.collection("users").doc(uid).delete().catch(() => {});

  // 3) (opsiyonel) Bu kullanıcıya atanmış işleri boşaltmak istiyorsan burada yap
  // const qs = await adminDb.collection('tasks').where('assignedTo_uid', '==', uid).get();
  // const w = db.bulkWriter();
  // qs.forEach(d => w.update(d.ref, { assignedTo_uid: null, assignedTo_email: null }));
  // await w.close();

  return { ok: true, uid };
});

// ====== IMPORTS ======
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

// Ensure admin is initialized once
if (!getApps().length) {
  initializeApp();
}

// Basit bellek içi cache ve cookie jar (aynı instance yaşadığı sürece geçerli)
const __tpCache   = global.__tpCache   || (global.__tpCache   = new Map());
const __cookieJar = global.__cookieJar || (global.__cookieJar = new Map());

// Küçük yardımcılar
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const loadCookiesFor = (key) => __cookieJar.get(key) || [];
const saveCookiesFor = (key, cookies) => __cookieJar.set(key, cookies);

// ====== Data URL parse helper ======
function parseDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) throw new Error('Geçersiz data URL');
  const contentType = m[1];
  const base64 = m[2];
  const buffer = Buffer.from(base64, 'base64');
  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
  return { contentType, buffer, ext };
}

// ====== Görseli Storage'a yazan yardımcı ======
async function persistImageToStorage(src, applicationNumber) {
  try {
    const bucket = getStorage().bucket();
    const safeAppNo = String(applicationNumber || 'unknown').replace(/[^\w-]/g, '_');
    let buffer, contentType, ext;

    if (String(src).startsWith('data:')) {
      const parsed = parseDataUrl(src);
      buffer = parsed.buffer;
      contentType = parsed.contentType;
      ext = parsed.ext;
    } else {
      // HTTP(S) kaynağını indir
      const resp = await fetch(src);
      if (!resp.ok) throw new Error(`Resim indirilemedi: ${resp.status}`);
      const arrayBuf = await resp.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
      contentType = resp.headers.get('content-type') || 'image/jpeg';
      ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    }

    const filePath = `trademarks/${safeAppNo}/logo.${ext}`;
    const file = bucket.file(filePath);
    await file.save(buffer, {
      contentType,
      resumable: false,
      metadata: { cacheControl: 'public,max-age=31536000' },
    });

    // İmzalı URL (2035'e kadar)
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '2035-01-01',
    });

    return { imagePath: filePath, imageSignedUrl: signedUrl, publicImageUrl: `https://storage.googleapis.com/${bucket.name}/${filePath}` };
  } catch (e) {
    logger.warn('Görsel Storage’a kaydedilemedi, data URL döndürülecek.', { message: e?.message });
    return { imagePath: '', imageSignedUrl: '', publicImageUrl: '' };
  }
}

// ====== reCAPTCHA tespiti (bypass YOK) ======
async function detectCaptcha(page) {
  const text = (await page.evaluate(() => document.body.innerText || '')).toLowerCase();
  return /recaptcha|ben robot değilim|i'm not a robot|lütfen doğrulayın/.test(text);
}

// ====== MUI tablolarını DOM'dan parse eden fonksiyon ======
function domParseFn() {
  const out = {
    applicationNumber:null, applicationDate:null, registrationNumber:null, registrationDate:null,
    intlRegistrationNumber:null, documentNumber:null, bulletinDate:null, bulletinNo:null,
    regBulletinDate:null, regBulletinNo:null, protectionDate:null, status:null, priorityInfo:null,
    niceClasses:[], type:null, trademarkName:null, agentInfo:null, ownerId:null, owner:null, ownerAddress:null,
    decision:null, decisionReason:null, goods:[], imageUrl:null, found:false
  };

  const normDate = (s) => {
    const m = (s||'').match(/\b(\d{2})[./](\d{2})[./](\d{4})\b/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : (s || null);
  };
  const txt = (n) => (n && (n.textContent || '')).trim();
  const dashToEmpty = (v) => (v === '-' ? '' : v);

  const tables = Array.from(document.querySelectorAll('table.MuiTable-root'));
  if (!tables.length) return out;

  // 1) Özet tablo (label/value)
  const t0 = tables[0];
  const rows0 = t0.querySelectorAll('tbody tr');

  rows0.forEach(tr => {
    const tds = Array.from(tr.querySelectorAll('td'));
    if (tds.length === 2) {
      const label = txt(tds[0]).toLowerCase();
      const cell  = tds[1];
      const raw   = txt(cell);
      const val   = dashToEmpty(raw);

      if (label.includes('marka adı')) out.trademarkName = val;
      else if (label.includes('sahip bilgileri')) {
        const ps = Array.from(cell.querySelectorAll('p')).map(txt).filter(Boolean);
        out.ownerId = ps[0] || null;
        out.owner = ps[1] || null;
        out.ownerAddress = ps.slice(2).join(' ') || null;
      }
      else if (label.includes('rüçhan bilgileri')) out.priorityInfo = val;
    } else if (tds.length === 4) {
      const label1 = txt(tds[0]).toLowerCase(), value1 = dashToEmpty(txt(tds[1]));
      const label2 = txt(tds[2]).toLowerCase(), value2 = dashToEmpty(txt(tds[3]));

      // --- ÖNCE daha spesifik olanları kontrol et ---
      if (label1.includes('uluslararası tescil numarası')) out.intlRegistrationNumber = value1;
      else if (label1.includes('tescil numarası')) out.registrationNumber = value1;
      else if (label1.includes('başvuru numarası')) out.applicationNumber = value1;
      else if (label1.includes('marka ilan bülten tarihi')) out.bulletinDate = normDate(value1);
      else if (label1.includes('marka ilan bülten no')) out.bulletinNo = value1;
      else if (label1.includes('tescil yayın bülten tarihi')) out.regBulletinDate = normDate(value1);
      else if (label1.includes('tescil yayın bülten no')) out.regBulletinNo = value1;
      else if (label1.includes('koruma tarihi')) out.protectionDate = normDate(value1);
      else if (label1.includes('nice sınıfları')) {
        out.niceClasses = (value1 || '')
          .split(/[^\d]+/)
          .map(s => s.trim())
          .filter(Boolean);
      } else if (label1.includes('karar')) out.decision = value1;

      if (label2.includes('uluslararası tescil numarası')) out.intlRegistrationNumber = value2;
      else if (label2.includes('tescil numarası')) out.registrationNumber = value2;
      else if (label2.includes('başvuru tarihi')) out.applicationDate = normDate(value2);
      else if (label2.includes('tescil tarihi')) out.registrationDate = normDate(value2);
      else if (label2.includes('evrak numarası')) out.documentNumber = value2;
      else if (label2.includes('tescil yayın bülten tarihi')) out.regBulletinDate = normDate(value2);
      else if (label2.includes('tescil yayın bülten no')) out.regBulletinNo = value2;
      else if (label2.includes('marka ilan bülten tarihi')) out.bulletinDate = normDate(value2);
      else if (label2.includes('marka ilan bülten no')) out.bulletinNo = value2;
      else if (label2.includes('durumu')) out.status = value2;
      else if (label2 === 'türü') out.type = value2;
      else if (label2.includes('karar gerekçesi')) out.decisionReason = value2;
    }
  });

  // 2) GOODS tablosunu THEAD başlığıyla tespit et
  const goodsTable = tables.find(t => {
    const ths = Array.from(t.querySelectorAll('thead th'));
    return ths.length >= 2 &&
           /sınıf/i.test(txt(ths[0])) &&
           /mal ve hizmetler/i.test(txt(ths[1]));
  });

  if (goodsTable) {
    const rows1 = goodsTable.querySelectorAll('tbody tr');
    rows1.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      const cls = txt(tds[0]);
      const desc = txt(tds[1]);
      if (cls) out.goods.push({ class: cls, description: desc });
    });
  }

  // 3) Görsel (data URL veya URL)
  const scope = t0.closest('section,div,main') || document;
  const img = scope.querySelector('img[alt*="Marka"], img[src^="data:image"], img[src*="resim"], img[src*="marka"], .trademark-image img');
  if (img && img.src && !/icon|logo|button|avatar/i.test(img.src)) {
    try { out.imageUrl = new URL(img.src, location.href).href; }
    catch { out.imageUrl = img.src; }
  }

  out.found = !!(out.trademarkName || out.applicationNumber || out.registrationNumber);
  return out;
}

// ====== COMMON HANDLER ======
async function handleScrapeTrademark(basvuruNo) {
  if (!basvuruNo) {
    throw new HttpsError('invalid-argument', 'Başvuru numarası (basvuruNo) zorunludur.');
  }

  logger.info('[scrapeTrademarkPuppeteer] Başlıyor', { basvuruNo });

  // ---- 0) 5 dk Cache ----
  const cached = __tpCache.get(basvuruNo);
  if (cached && (Date.now() - cached.ts) < 5 * 60 * 1000) {
    logger.info('Cache hit, 5 dk içindeki sonucu döndürüyorum.');
    return cached.data;
  }

  // ---- 1) Global oran sınırlama (45–60 sn jitter) ----
  const lastRequestKey = 'turkpatent_last_request';
  const minDelay = 45000 + Math.floor(Math.random() * 15000);
  const lastRequest = global[lastRequestKey] || 0;
  const elapsed = Date.now() - lastRequest;
  if (elapsed < minDelay) {
    const waitTime = minDelay - elapsed;
    logger.info(`Rate limiting: ${waitTime}ms bekleyecek`);
    await sleep(waitTime);
  }
  global[lastRequestKey] = Date.now();

  // ---- 2) Global BACKOFF ----
  const tpBackoffKey = 'turkpatent_backoff_until';
  const backoffRemaining = Math.max(0, (global[tpBackoffKey] || 0) - Date.now());
  if (backoffRemaining > 0) {
    const retryAfterSec = Math.ceil(backoffRemaining / 1000);
    logger.info(`Backoff aktif, ${retryAfterSec}s sonra tekrar deneyin.`);
    return {
      status: 'Backoff',
      found: false,
      applicationNumber: basvuruNo,
      retryAfterSec,
      message: 'TürkPatent geçici limitten dolayı bekleme süresi aktif.'
    };
  }

  let browser;
  let page;

  try {
const isLocal = process.env.FUNCTIONS_EMULATOR === 'true';

const launchOptions = isLocal ? {
  headless: true,
  executablePath: process.env.CHROME_PATH || await chromium.executablePath(),
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1920, height: 1080 }
} : {
  headless: chromium.headless,
  executablePath: await chromium.executablePath(),
  args: [
    ...chromium.args,
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-features=VizDisplayCompositor',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security'
  ],
  defaultViewport: { width: 1920, height: 1080 }
};


    const browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),  // 🔴 kritik satır
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      protocolTimeout: 180000
    });

    page = await browser.newPage();

    // --- Stealth / Kimlik ayarları ---
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7' });
    try { await page.emulateTimezone('Europe/Istanbul'); } catch {}
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // --- Cookie reuse ---
    const savedCookies = loadCookiesFor('turkpatent');
    if (savedCookies.length) {
      try { await page.setCookie(...savedCookies); } catch {}
    }

    // Network monitoring ve request interceptor
      await page.setRequestInterception(true);
      
      page.on('request', (request) => {
        logger.info('Request:', request.url(), request.method());
        const resourceType = request.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      page.on('response', (response) => {
        if (response.url().includes('turkpatent') || response.url().includes('api') || response.url().includes('search')) {
          logger.info('Response:', response.url(), response.status());
        }
      });

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    logger.info('[scrapeTrademarkPuppeteer] Sayfaya gidiliyor...');
    await page.goto('https://www.turkpatent.gov.tr/arastirma-yap?form=trademark', { waitUntil: 'domcontentloaded' });

    // --- Popup/Modal kapat ---
    try {
      try { await page.waitForSelector('.jss84 .jss92', { timeout: 2000 }); await page.click('.jss84 .jss92'); } catch {}
      try {
        await page.waitForSelector('[role="dialog"], .MuiDialog-root, .MuiModal-root', { timeout: 2000 });
        const closeBtn = await page.$('button[aria-label="Close"], button[aria-label="Kapat"], .close');
        if (closeBtn) { await closeBtn.click(); }
      } catch {}
    } catch (modalError) {
      logger.info('Modal kapatma hatası (normal):', { message: modalError?.message });
    }

    // --- "Dosya Takibi" sekmesi ---
    try {
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button[role="tab"]');
        for (const btn of buttons) {
          if (btn.textContent && btn.textContent.includes('Dosya Takibi')) {
            if (btn.getAttribute('aria-selected') !== 'true') btn.click();
            return;
          }
        }
      });
      await page.waitForSelector('input[placeholder="Başvuru Numarası"]', { timeout: 5000 });
      logger.info('Dosya Takibi sekmesine geçiş başarılı.');
    } catch (tabError) {
      logger.error('Dosya Takibi sekmesine geçiş hatası:', { message: tabError?.message });
      throw new HttpsError('internal', `Tab geçişi başarısız: ${tabError.message}`);
    }

    // --- Form doldur ---
    logger.info('[scrapeTrademarkPuppeteer] Form doldurma işlemi...');
    try {
      await page.waitForSelector('input[placeholder="Başvuru Numarası"]', { timeout: 5000 });
      const input = await page.$('input[placeholder="Başvuru Numarası"]');
      if (!input) throw new Error('Başvuru numarası input alanı bulunamadı');

      await input.click({ clickCount: 3 });
      await input.type(basvuruNo);
      await page.evaluate((inputEl, value) => {
        inputEl.value = value;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }, input, basvuruNo);

      logger.info(`Başvuru numarası yazıldı: ${basvuruNo}`);
    } catch (inputError) {
      logger.error('Form doldurma hatası:', { message: inputError?.message });
      throw new HttpsError('internal', `Form doldurma başarısız: ${inputError.message}`);
    }

    // --- TEK TIK + DOM BEKLEME (JSON YOK) ---
    logger.info('[scrapeTrademarkPuppeteer] Sorgula butonu tıklanıyor ve DOM bekleniyor...');
    await sleep(400 + Math.floor(Math.random() * 600)); // küçük jitter

    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => /sorgula/i.test((b.textContent || '')) && !b.disabled && !b.getAttribute('aria-disabled'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) throw new HttpsError('internal', 'Sorgula butonu bulunamadı');

    // Captcha kontrolü (bypass yok; anlamlı dönüş)
    if (await detectCaptcha(page)) {
      const retryAfterSec = 120 + Math.floor(Math.random()*60);
      global['turkpatent_backoff_until'] = Date.now() + retryAfterSec * 1000;
      return {
        status: 'CaptchaRequired',
        found: false,
        applicationNumber: basvuruNo,
        retryAfterSec,
        message: 'reCAPTCHA doğrulaması gerekiyor. Lütfen doğrulayıp tekrar deneyin.'
      };
    }

    // DOM yüklenmesini bekle
    await page.waitForSelector('table#results tbody tr', { timeout: 60000 });

    // DOM'dan veriyi çek
    const tdata = await page.evaluate(domParseFn);

    // Basit hata metni taraması
    const hasError = await page.evaluate(() => {
      const els = document.querySelectorAll('.error, .alert-danger, .MuiAlert-message, p, div, span, h1, h2, h3');
      const keys = ['bulunamadı','sonuç yok','hata','geçersiz','çok fazla deneme','too many attempts','rate limit','sistem meşgul','geçici olarak hizmet dışı'];
      for (const el of Array.from(els)) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (keys.some(k => t.includes(k))) return (el.textContent || '').trim();
      }
      return null;
    });

    if (hasError) {
      return { applicationNumber: basvuruNo, found: false, status: 'NotFound', message: hasError, error: hasError };
    }

    if (!tdata?.found) {
      const pageTitle = await page.title();
      return { applicationNumber: basvuruNo, found: false, status: 'DataExtractionError', message: 'Sayfa yüklendi ancak veri çıkarılamadı', pageTitle };
    }

    // Normalizasyon
    const normalized = {
      applicationNumber: tdata.applicationNumber || basvuruNo,
      applicationDate:  tdata.applicationDate || '',
      trademarkName:    tdata.trademarkName || '',
      imageUrl:         tdata.imageUrl || '',
      owner:            tdata.owner || '',
      status:           tdata.status || '',
      niceClasses:      Array.isArray(tdata.niceClasses) ? tdata.niceClasses : [],

      // ek alanlar
      registrationNumber:        tdata.registrationNumber || '',
      registrationDate:          tdata.registrationDate || '',
      intlRegistrationNumber:    tdata.intlRegistrationNumber || '',
      documentNumber:            tdata.documentNumber || '',
      bulletinDate:              tdata.bulletinDate || '',
      bulletinNo:                tdata.bulletinNo || '',
      regBulletinDate:           tdata.regBulletinDate || '',
      regBulletinNo:             tdata.regBulletinNo || '',
      protectionDate:            tdata.protectionDate || '',
      type:                      tdata.type || '',
      ownerId:                   tdata.ownerId || '',
      ownerAddress:              tdata.ownerAddress || '',
      agentInfo:                 tdata.agentInfo || '',
      decision:                  tdata.decision || '',
      decisionReason:            tdata.decisionReason || '',
      goods:                     Array.isArray(tdata.goods) ? tdata.goods : []
    };

    logger.info('Marka verisi DOM’dan çıkarıldı', {
      applicationNumber: normalized.applicationNumber,
      applicationDate: normalized.applicationDate,
      trademarkName: normalized.trademarkName,
      hasImage: !!normalized.imageUrl,
      goodsCount: normalized.goods.length
    });

    // --- Görsel varsa Storage'a yaz ve linkleri ekle ---
    if (normalized.imageUrl) {
      const { imagePath, imageSignedUrl, publicImageUrl } = await persistImageToStorage(normalized.imageUrl, normalized.applicationNumber);
      if (imagePath) {
        normalized.imagePath = imagePath;
        normalized.imageSignedUrl = imageSignedUrl;
        normalized.publicImageUrl = publicImageUrl;
        // UI kolaylığı için imageUrl'ü imzalı URL ile değiştir
        normalized.imageUrl = imageSignedUrl || publicImageUrl || normalized.imageUrl;
      }
    }

    const result = { status: 'Success', found: true, data: normalized, ...normalized };
    __tpCache.set(basvuruNo, { ts: Date.now(), data: result });
    return result;

  } catch (err) {
    logger.error('[scrapeTrademarkPuppeteer] Genel hata', { message: err?.message, stack: err?.stack, basvuruNo });
    throw new HttpsError('internal', `Puppeteer hatası: ${err?.message || String(err)}`);
  } finally {
    // Cookie’leri sakla (başarılı/başarısız fark etmez)
    try {
      // eslint-disable-next-line no-undef
      if (typeof page !== 'undefined' && page) {
        const freshCookies = await page.cookies();
        if (freshCookies?.length) saveCookiesFor('turkpatent', freshCookies);
      }
    } catch {}

    if (typeof browser !== 'undefined' && browser) {
      try { await browser.close(); logger.info('Browser kapatıldı'); }
      catch (closeError) { logger.error('Browser kapatma hatası:', { message: closeError?.message }); }
    }
  }
}

// ====== CALLABLE (onCall) VERSİYONU ======
export const scrapeTrademark = onCall(
  { region: 'europe-west1', memory: '2GiB', timeoutSeconds: 180 },
  async (request) => {
    const basvuruNo = request.data?.basvuruNo;
    return await handleScrapeTrademark(basvuruNo);
  }
);
// ====== YENİLENMİŞ SAHİP NUMARASI İLE TOPLU MARKA ARAMA (FOUND YALNIZCA SATIR VARSA) ======
// ====== YENİLENMİŞ SAHİP NUMARASI İLE TOPLU MARKA ARAMA (iframe + role="number" + role-öncelikli parse) ======
export const scrapeOwnerTrademarks = onCall(
  { region: 'europe-west1', memory: '2GiB', timeoutSeconds: 300 },
  async (request) => {
    const { ownerId, maxRetries = 2 } = request.data || {};
    if (!ownerId) {
      throw new HttpsError('invalid-argument', 'Sahip numarası (ownerId) zorunludur.');
    }

    logger.info('[scrapeOwnerTrademarks] Başlıyor', { ownerId, maxRetries });

    const isLocal = !!process.env.FUNCTIONS_EMULATOR || (!process.env.K_SERVICE && process.env.NODE_ENV !== 'production');
    let browser;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        logger.info(`Deneme ${retryCount + 1}/${maxRetries} başlıyor...`);

        // === Browser Başlatma ===
        if (isLocal) {
          const puppeteerLocal = await import('puppeteer');
          browser = await puppeteerLocal.default.launch({
            headless: 'new',
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-blink-features=AutomationControlled',
            ],
            defaultViewport: { width: 1366, height: 900 },
          });
        } else {
          const execPath = await chromium.executablePath();
          browser = await puppeteer.launch({
            args: [
              ...chromium.args,
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-blink-features=AutomationControlled',
            ],
            defaultViewport: chromium.defaultViewport || { width: 1366, height: 900 },
            executablePath: execPath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
          });
        }

        const page = await browser.newPage();
        await page.setJavaScriptEnabled(true);
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Basit bot-detection bypass
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });
          window.chrome = {
            runtime: {},
            loadTimes: function () { return { requestTime: Date.now() / 1000 }; },
            csi: function () { return { startE: Date.now(), onloadT: Date.now() }; },
          };
        });

        // Request interception - reCAPTCHA isteklerini engelle + hafif içerik diyeti
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const url = req.url();
          const resourceType = req.resourceType();

          if (
            url.includes('recaptcha') ||
            url.includes('gstatic.com/recaptcha') ||
            url.includes('google.com/recaptcha')
          ) {
            logger.info('reCAPTCHA isteği engellendi');
            req.abort();
            return;
          }

          if (['image', 'stylesheet', 'font', 'media', 'manifest'].includes(resourceType)) {
            req.abort();
          } else {
            req.continue();
          }
        });

        // Sayfayı yükle
        await page.goto('https://www.turkpatent.gov.tr/arastirma-yap', {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
        logger.info('Sayfa başarıyla yüklendi.');

        // İnsan benzeri küçük davranış
        await page.mouse.move(200, 200);
        await page.mouse.click(200, 200);
        await page.keyboard.type('test');
        await sleep(700);

        // === Form Doldurma ===
        await page.waitForSelector('input', { timeout: 10000 });

        const inputResult = await page.evaluate((val) => {
          const input =
            document.querySelector('input[placeholder*="Kişi Numarası" i]') ||
            document.querySelector('input[placeholder*="kişi" i]') ||
            Array.from(document.querySelectorAll('input')).find(
              (i) =>
                (i.placeholder || '').toLowerCase().includes('kişi') ||
                (i.placeholder || '').toLowerCase().includes('numara')
            );
          if (!input) return { success: false, error: 'Kişi Numarası inputu bulunamadı' };

          input.focus();
          input.value = '';
          input.value = String(val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true };
        }, String(ownerId));

        if (!inputResult.success) {
          throw new Error(inputResult.error);
        }

        await sleep(600);

        // === Sorgula Butonuna Tıklama ===
        const clickResult = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(
            (b) => /sorgula/i.test((b.textContent || b.value || '').trim()) && !b.disabled
          );
          if (!btn) return { success: false, error: 'SORGULA butonu bulunamadı' };
          btn.click();
          return { success: true };
        });

        if (!clickResult.success) {
          throw new Error(clickResult.error);
        }

        logger.info('Sorgula butonuna tıklandı, sonuçlar bekleniyor...');

        // === Selector listeleri (satır tespiti için) ===
        const rowSelectorList = [
          'table tbody tr[role="number"]',
          'table tbody tr',
          '.MuiTable-root tbody tr[role="number"]',
          '.MuiTable-root tbody tr',
          '[role="table"] tbody tr',
          // MUI DataGrid / virtualized:
          '[role="grid"] [role="row"]',
          '[role="rowgroup"] [role="row"]',
          'tbody tr[role="number"]',
          'tbody tr'
        ];

        // === Her frame’de satır var mı kontrolü (iframe-aware probe) ===
        async function probeAnyFrame(page) {
          const frames = [page.mainFrame(), ...page.frames()];
          for (const f of frames) {
            try {
              const res = await f.evaluate((selectors) => {
                const bodyText = (document.body.innerText || '').toLowerCase();

                const loadingKw = ['yükleniyor', 'loading', 'bekleyin', 'aranıyor'];
                const notFoundKw = ['0 kayıt bulundu', 'kayıt bulunamadı', 'sonuç bulunamadı', 'hiç kayıt', 'sonuç yok'];
                const errKw = ['hata oluştu', 'sistem hatası', 'geçici hata'];

                const isLoading   = loadingKw.some(k => bodyText.includes(k));
                const hasNotFound = notFoundKw.some(k => bodyText.includes(k));
                const hasError    = errKw.some(k => bodyText.includes(k));

                let rowCount = 0, usedSelector = '';
                for (const sel of selectors) {
                  const n = document.querySelectorAll(sel).length;
                  if (n > 0) { rowCount = n; usedSelector = sel; break; }
                }

                // İlk 2 satır ön izlemesi
                const firstRowsPreview = [];
                if (rowCount > 0) {
                  const trs = document.querySelectorAll(usedSelector);
                  const lim = Math.min(2, trs.length);
                  for (let i = 0; i < lim; i++) {
                    firstRowsPreview.push((trs[i].innerText || '').replace(/\s+/g, ' ').trim());
                  }
                }

                return { isLoading, hasNotFound, hasError, rowCount, usedSelector, firstRowsPreview };
              }, rowSelectorList);

              if (res?.rowCount > 0 || res?.hasNotFound || res?.hasError) {
                return { frame: f, ...res };
              }
            } catch {}
          }
          return null;
        }

        // === GELİŞTİRİLMİŞ SONUÇ BEKLEME: "found" sadece gerçek satır varsa ===
        let status = null;
        let foundFrame = null;
        const maxWaitTime = 120000; // 2 dk
        const pollEvery = 1500;
        const t0 = Date.now();

        while (Date.now() - t0 < maxWaitTime) {
          const p = await probeAnyFrame(page);
          if (p) {
            logger.info('[probe]', {
              rowCount: p.rowCount,
              usedSelector: p.usedSelector,
              isLoading: p.isLoading,
              hasNotFound: p.hasNotFound,
              hasError: p.hasError
            });

            if (p.rowCount > 0 && !p.isLoading) {
              status = 'found';
              foundFrame = p.frame;  // satırlar hangi frame’deyse onu kullan
              logger.info('Sonuç durumu belirlendi: found (satır sayısı: ' + p.rowCount + ')');
              if (p.firstRowsPreview?.length) logger.info('[rows-preview]', { rows: p.firstRowsPreview });
              break;
            }
            if (p.hasNotFound && !p.isLoading) { status = 'not_found'; break; }
            if (p.hasError) { status = 'error'; break; }
          }
          await sleep(pollEvery);
        }

        if (!status) {
          logger.warn('Timeout: Sonuç durumu belirlenemedi');
          status = 'timeout';
        }

        // Found ise en az bir satır görünene kadar garanti bekleyelim
        if (status === 'found') {
          try {
            await (foundFrame || page).waitForSelector(
              'table tbody tr, .MuiTable-root tbody tr, [role="grid"] [role="row"]',
              { visible: true, timeout: 30000 }
            );
          } catch {}
        }

        // === SONUÇ İŞLEME / PARSE (role-öncelikli + iframe-aware) ===
        if (status === 'found') {
          logger.info('Veri çekiliyor...');
          await sleep(800);

          const frameForParse = foundFrame || page.mainFrame();

          const { rows, rowCount, usedSelector } = await frameForParse.evaluate(() => {
            const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

            const selectors = [
              'table tbody tr[role="number"]',
              '.MuiTable-root tbody tr[role="number"]',
              '[role="table"] tbody tr[role="number"]',
              'table tbody tr',
              '.MuiTable-root tbody tr',
              '[role="table"] tbody tr',
              // fallback’lar:
              '[role="grid"] [role="row"]',
              '[role="rowgroup"] [role="row"]',
              'tbody tr[role="number"]',
              'tbody tr'
            ];

            let trs = [];
            let usedSelector = '';
            for (const sel of selectors) {
              const list = document.querySelectorAll(sel);
              if (list.length > 0) { trs = Array.from(list); usedSelector = sel; break; }
            }

            const rows = trs.map(tr => {
              // Önce role’lü hücre
              const byRole = (role) => {
                const el =
                  tr.querySelector(`td[role="${role}"]`) ||
                  tr.querySelector(`[role="cell"][data-field="${role}"]`);
                return el ? norm(el.innerText) : '';
              };

              // Sonra index fallback (ilk kolon numara/checkbox olabilir)
              let cells = Array.from(tr.querySelectorAll('td'));
              if (cells.length === 0) cells = Array.from(tr.querySelectorAll('[role="cell"]'));
              const get = (i) => (cells[i] ? norm(cells[i].innerText) : '');

              const applicationNumber = byRole('applicationNo')   || get(1) || get(0);
              const brandName        = byRole('markName')        || get(2) || get(1);
              const ownerName        = byRole('holdName')        || get(3) || get(2);
              const applicationDate  = byRole('applicationDate') || get(4) || get(3);
              const registrationNo   = byRole('registrationNo')  || get(5) || get(4);
              const state            = byRole('state')           || get(6) || get(5);
              const niceText         = byRole('niceClasses')     || get(7) || get(6);

              const niceList = (niceText || '')
                .split(/[^\d]+/)
                .map(x => x.trim())
                .filter(Boolean);

              const img = tr.querySelector('img') || tr.querySelector('picture img') || tr.querySelector('[role="cell"] img');
              const a   = tr.querySelector('a[href]');

              return {
                applicationNumber,
                brandName,
                ownerName,
                applicationDate,
                registrationNumber: registrationNo,
                status: state,
                niceClasses: niceText,
                niceList,
                imageUrl: img ? img.getAttribute('src') : '',
                detailUrl: a ? a.getAttribute('href') : ''
              };
            }).filter(r => r && (r.applicationNumber || r.brandName));

            return { rows, rowCount: trs.length, usedSelector };
          });

          logger.info(`[owner-scrape] Satır sayısı (ham): ${rowCount} | Kullanılan selector: ${usedSelector}`);
          logger.info(`[owner-scrape] Parse sonrası kayıt: ${rows.length}`);

          if (rows.length === 0) {
            // Teşhis için ilk satırdan kısa HTML kesiti
            try {
              const snippet = await (foundFrame || page).evaluate((sel) => {
                const tr = document.querySelector(sel);
                if (!tr) return '';
                const html = tr.outerHTML || '';
                return html.slice(0, 600);
              }, usedSelector);
              if (snippet) logger.info('[first-tr-html-snippet]', { snippet });
            } catch {}

            return {
              status: 'NotFound',
              found: false,
              ownerId,
              count: 0,
              message: 'Tablo bulundu ancak veri yok'
            };
          }

          return {
            status: 'Success',
            found: true,
            count: rows.length,
            ownerId,
            items: rows
          };

        } else if (status === 'not_found') {
          logger.info('Kayıt bulunamadı.');
          return {
            status: 'NotFound',
            found: false,
            ownerId,
            count: 0,
            message: 'Belirtilen sahip numarası için kayıt bulunamadı.'
          };

        } else {
          throw new Error(`Beklenmeyen durum: ${status}`);
        }

      } catch (err) {
        logger.error(`[scrapeOwnerTrademarks] Deneme ${retryCount + 1} hatası:`, { message: err?.message });

        // Screenshot al (debug)
        if (browser) {
          try {
            const pages = await browser.pages();
            if (pages.length > 0) {
              const screenshot = await pages[0].screenshot({ encoding: 'base64', quality: 30 });
              if (screenshot) logger.info('Hata screenshot alındı');
            }
          } catch (e) {
            logger.warn('Screenshot alınamadı:', e.message);
          }
        }

        if (retryCount >= maxRetries - 1) {
          throw new HttpsError('internal', `Owner arama hatası (${maxRetries} deneme): ${err?.message || String(err)}`);
        }

        retryCount++;
        logger.info(`${retryCount + 1}. deneme için bekleniyor...`);
        await sleep(5000 * retryCount);

      } finally {
        if (browser) {
          try {
            await browser.close();
            browser = null;
            logger.info('Browser kapatıldı');
          } catch (e) {
            logger.warn('Browser kapatma hatası:', e.message);
          }
        }
      }
    }

    throw new HttpsError('internal', 'Tüm denemeler başarısız oldu');
  }
);

// =========================================================
//              YENİ: YENİLEME OTOMASYON FONKSİYONU
// =========================================================

/**
 * Portföy kayıtlarındaki yenileme tarihlerini kontrol ederek
 * yeni yenileme görevleri oluşturan callable fonksiyon.
 * Kurallar:
 * - taskType: '22'
 * - ipRecords status "geçersiz" veya "rejected" olmamalı
 * - Yenileme tarihi bugünden 6 ay önce veya sonraki aralığa girmeli
 * - WIPO/ARIPO kayıtları için sadece 'parent' hiyerarşisindekiler işleme alınır.
 * - Atama, taskAssignments koleksiyonundaki kurala göre yapılır.
 */
async function resolveApprovalAssignee(adminDb, taskTypeId = "22") {
  const out = { uid: null, email: null, reason: "unknown" };

  const snap = await adminDb.collection("taskAssignments").doc(String(taskTypeId)).get();
  if (!snap.exists) { out.reason = "rule-missing"; return out; }

  const rule = snap.data() || {};
  const list = Array.isArray(rule.approvalStateAssigneeIds) ? rule.approvalStateAssigneeIds : [];
  if (!list.length) { out.reason = "approvalStateAssigneeIds-empty"; return out; }

  const uid = String(list[0]);
  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (!userSnap.exists) { out.reason = "user-missing"; return out; }

  const email = userSnap.data()?.email || null;
  if (!email) { out.reason = "email-missing"; return out; }

  return { uid, email, reason: "ok" };
}
export const checkAndCreateRenewalTasks = onCall({ region: "europe-west1" }, async (request) => {
  logger.log('🔄 Renewal task check started manually with updated rules');

  const taskTypeId = "22";
  const TODAY = new Date();
  const sixMonthsAgo = new Date();  sixMonthsAgo.setMonth(TODAY.getMonth() - 6);
  const sixMonthsLater = new Date(); sixMonthsLater.setMonth(TODAY.getMonth() + 6);

  // 1) Atama: yalnızca approvalStateAssigneeIds
  let assignedTo_uid = null;
  let assignedTo_email = null;
  try {
    const ruleSnap = await adminDb.collection("taskAssignments").doc(taskTypeId).get();
    if (!ruleSnap.exists) throw new HttpsError("failed-precondition", "taskAssignments/22 bulunamadı");

    const rule = ruleSnap.data() || {};
    const approvalIds = Array.isArray(rule.approvalStateAssigneeIds) ? rule.approvalStateAssigneeIds : [];
    if (!approvalIds.length) throw new HttpsError("failed-precondition", "approvalStateAssigneeIds boş");

    const uid = String(approvalIds[0]);
    const userSnap = await adminDb.collection("users").doc(uid).get();
    if (!userSnap.exists) throw new HttpsError("failed-precondition", `users/${uid} bulunamadı`);
    const email = userSnap.data()?.email || null;
    if (!email) throw new HttpsError("failed-precondition", `users/${uid} içinde email alanı yok`);

    assignedTo_uid = uid;
    assignedTo_email = email;
    logger.log("👤 Approval assignee resolved", { assignedTo_uid, assignedTo_email });
  } catch (e) {
    logger.error("❌ Assignee resolve error:", e);
    throw e instanceof HttpsError ? e : new HttpsError("internal", "Atama belirlenemedi", e?.message || String(e));
  }

  try {
    // 2) Uygun IP kayıtlarını tara → oluşturulacak taskların ham verisini hazırla (YAZMA YOK)
    const allIpRecordsSnap = await adminDb.collection('ipRecords').get();
    const candidates = [];
    let recordsProcessed = 0;

    for (const doc of allIpRecordsSnap.docs) {
      const ipRecord = doc.data();
      const ipRecordId = doc.id;
      recordsProcessed++;

      // Durum filtresi
      if (ipRecord.status === 'geçersiz' || ipRecord.status === 'rejected') {
        logger.log(`⏩ ${ipRecordId} '${ipRecord.status}', skip.`);
        continue;
      }

      // WIPO/ARIPO parent zorunluluğu
      if ((ipRecord.wipoIR || ipRecord.aripoIR) && ipRecord.transactionHierarchy !== 'parent') {
        logger.log(`⏩ ${ipRecordId} WIPO/ARIPO child, skip.`);
        continue;
      }

      // Yenileme tarihi hesapla
      let renewalDate = null;
      if (ipRecord.renewalDate) {
        if (typeof ipRecord.renewalDate?.toDate === 'function') {
          renewalDate = ipRecord.renewalDate.toDate();
        } else if (typeof ipRecord.renewalDate === 'string' || ipRecord.renewalDate instanceof Date) {
          const d = new Date(ipRecord.renewalDate);
          renewalDate = isNaN(d.getTime()) ? null : d;
        }
      }
      if (!renewalDate && ipRecord.applicationDate) {
        let appDate = null;
        if (typeof ipRecord.applicationDate?.toDate === 'function') {
          appDate = ipRecord.applicationDate.toDate();
        } else if (typeof ipRecord.applicationDate === 'string' || ipRecord.applicationDate instanceof Date) {
          const d = new Date(ipRecord.applicationDate);
          appDate = isNaN(d.getTime()) ? null : d;
        }
        if (appDate) {
          const d = new Date(appDate);
          d.setFullYear(d.getFullYear() + 10);
          renewalDate = d;
        }
      }
      if (!renewalDate) {
        logger.warn(`⚠️ ${ipRecordId} renewalDate yok/geçersiz, skip.`);
        continue;
      }

      // Pencere kontrolü
      if (renewalDate < sixMonthsAgo || renewalDate > sixMonthsLater) {
        logger.log(`⏩ ${ipRecordId} renewal (${renewalDate.toISOString().slice(0,10)}) pencere dışında, skip.`);
        continue;
      }

      // Zaten açık bir yenileme görevi var mı?
      const existing = await adminDb.collection('tasks')
        .where('relatedIpRecordId', '==', ipRecordId)
        .where('taskType', '==', taskTypeId)
        .where('status', 'in', ['awaiting_client_approval', 'open', 'in-progress'])
        .limit(1).get();
      if (!existing.empty) {
        logger.log(`ℹ️ ${ipRecordId} için mevcut yenileme görevi var, skip.`);
        continue;
      }

      // UI metinleri
      const dueISO = renewalDate.toISOString().slice(0, 10);
      const title = `${ipRecord.title} Marka Yenileme`;
      const description = `${ipRecord.title} adlı markanın yenileme süreci için müvekkil onayı bekleniyor. Yenileme tarihi: ${renewalDate.toLocaleDateString('tr-TR')}.`;

      // Henüz ID vermiyoruz; sadece veri şablonu hazırlıyoruz
      const data = {
        title,
        description,
        taskType: taskTypeId,
        relatedIpRecordId: ipRecordId,
        relatedIpRecordTitle: ipRecord.title,
        status: 'awaiting_client_approval',
        priority: 'medium',
        dueDate: dueISO,
        assignedTo_uid,
        assignedTo_email,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        history: [{
          action: 'Yenileme görevi otomatik olarak oluşturuldu. Müvekkil onayı bekleniyor.',
          timestamp: new Date().toISOString(),
          userEmail: assignedTo_email || 'sistem@evrekapatent.com'
        }]
      };

      candidates.push(data);
    }

    if (candidates.length === 0) {
      logger.log(`ℹ️ Yeni oluşturulacak yenileme görevi yok. İşlenen kayıt: ${recordsProcessed}`);
      return { success: true, count: 0, taskIds: [], processed: recordsProcessed };
    }

    // 3) TEK TRANSAKTION: blok ID ayır + tasks/{ID} olarak yaz + counter'ı güncelle
    const result = await admin.firestore().runTransaction(async (tx) => {
      const counterRef = adminDb.collection('counters').doc('tasks');
      const counterSnap = await tx.get(counterRef);

      let lastId = 0;
      if (counterSnap.exists) {
        const data = counterSnap.data() || {};
        lastId = Number(data.lastId || 0);
        if (!Number.isFinite(lastId)) lastId = 0;
      } else {
        // İlk kez: counter dokümanını oluştur
        tx.set(counterRef, { lastId: 0 });
        lastId = 0;
      }

      const newIds = [];
      for (let i = 0; i < candidates.length; i++) {
        const nextId = (lastId + 1 + i).toString(); // 🔢 belge ID’si (taskNo alanı yok!)
        const taskRef = adminDb.collection('tasks').doc(nextId);
        tx.set(taskRef, candidates[i]);
        newIds.push(nextId);
      }

      // Counter'ı son değere taşı
      const finalLastId = lastId + candidates.length;
      tx.set(counterRef, { lastId: finalLastId }, { merge: true });

      return newIds;
    });

    logger.log(`🎉 ${result.length} adet yenileme görevi oluşturuldu:`, result);
    return { success: true, count: result.length, taskIds: result, processed: candidates.length };

  } catch (error) {
    logger.error('❌ Renewal task creation failed:', error);
    throw new HttpsError('internal', 'Yenileme görevleri oluşturulurken bir hata oluştu.', error?.message || String(error));
  }
});
// Yeni: Yenileme (taskType=22) işi oluşturulduğunda müşteri mail taslağı aç
export const createClientNotificationOnRenewalTaskCreated = onDocumentCreated(
  { document: "tasks/{taskId}", region: "europe-west1" },
  async (event) => {
    const snap = event.data;
    const task = snap?.data() || {};
    const taskId = event.params.taskId;

    // Yalnızca yenileme + müvekkil onayı bekliyor
    if (String(task.taskType) !== "22") return null;
    if (task.status !== "awaiting_client_approval") return null;

    try {
      // 1) İlgili IP kaydı ve applicants
      const relatedIpRecordId = task.relatedIpRecordId;
      if (!relatedIpRecordId) return null;

      const ipRef = adminDb.collection("ipRecords").doc(relatedIpRecordId);
      const ipDoc = await ipRef.get();
      if (!ipDoc.exists) return null;

      const ipData = ipDoc.data() || {};
      const applicants = ipData.applicants || [];

      // 2) Alıcılar (mevcut yardımcıyı kullan)
      // notificationType sisteminizde 'marka' / 'trademark' gibi; sizde kullanılan key'i geçin
      const notificationType = (task.mainProcessType || "marka");
      const { to: toList = [], cc: ccList = [] } = await getRecipientsByApplicantIds(applicants, notificationType); // :contentReference[oaicite:4]{index=4}

      // 3) Şablon kuralı (taskType’a göre) - veritabanınızda zaten tanımlı
      // Örn: template_rules[sourceType='task', taskType='22'] → templateId
      let templateId = null;
      try {
        const ruleSnap = await adminDb.collection("template_rules")
          .where("sourceType", "==", "task")
          .where("taskType", "==", "22")
          .limit(1)
          .get();
        if (!ruleSnap.empty) {
          templateId = ruleSnap.docs[0].data()?.templateId || null;
        }
      } catch (e) {
        console.warn("template_rules lookup failed:", e?.message || e);
      }

      // 4) Konu/Gövde (İsterseniz burada template body/subject’i resolve edebilirsiniz;
      // yoksa boş geçin, UI zaten taslak üzerinde düzenliyor)
      const subject = task.title || `${ipData.title || "Marka"} Yenileme – Onay Talebi`;
      const body    = task.description || "Yenileme işlemi için onayınızı rica ederiz.";

      // 5) Eksik alan kontrolü → ortak statü mantığına uygun missing_info/awaiting… (örneğe paralel)
      const hasRecipients = (toList.length + ccList.length) > 0;
      const missingFields = [];
      if (!hasRecipients) missingFields.push("recipients");
      if (!templateId)    missingFields.push("template");
      const finalStatus = missingFields.length ? "missing_info" : "awaiting_client_approval";

      // 6) mail_notifications kaydını oluştur (ortak şemayla bire bir)
      const notificationDoc = {
        toList, ccList,                                 // ✔ alıcılar
        clientId: task.clientId || (applicants?.[0]?.id || null),
        subject, body,
        status: finalStatus,
        mode: "draft",
        isDraft: true,

        assignedTo_uid: task.assignedTo_uid || null,    // ✔ mevcut atamayı taşı
        assignedTo_email: task.assignedTo_email || null,

        sourceDocumentId: null,
        relatedIpRecordId,                               // ✔ işinizin ilişkilendiği IP kaydı
        associatedTaskId: taskId,                        // ✔ bu task’a bağlı
        associatedTransactionId: null,

        templateId,
        notificationType,
        source: "task_renewal_auto",
        missingFields,

        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await adminDb.collection("mail_notifications").add(notificationDoc); // :contentReference[oaicite:5]{index=5}
      console.log("✅ Renewal task notification draft created", { taskId });

      return null;
    } catch (err) {
      console.error("❌ renewal notification create failed:", err);
      return null;
    }
  }
);

// index.js (Yeni Yardımcı Fonksiyon: Client/IP Bilgisi Bulma)

/**
 * Monitored Marka ID'si üzerinden en ilişkili IP Kaydını ve Client ID'sini bulur.
 */

export const handleBulletinDeletion = onMessagePublished(
  { topic: 'bulletin-deletion', region: 'europe-west1', memory: '1GiB', cpu: 1, timeoutSeconds: 540 },
  async (event) => {
    console.log('🎯 handleBulletinDeletion triggered');
    console.log('📨 Event data:', JSON.stringify(event.data, null, 2));
    
    const { bulletinId, operationId } = event.data.message.json || {};
    if (!bulletinId || !operationId) {
      console.warn('⚠️ handleBulletinDeletion: eksik payload', {
        bulletinId,
        operationId,
        rawJson: event?.data?.message?.json
      });
      return null;
    }
    
    console.log(`🚀 Starting bulletin deletion: bulletinId=${bulletinId}, operationId=${operationId}`);
    
    try {
      await performBulletinDeletion(bulletinId, operationId);
      console.log(`✅ Bulletin deletion completed: ${bulletinId}`);
    } catch (e) {
      console.error('💥 handleBulletinDeletion failed:', {
        bulletinId,
        operationId,
        error: e?.message || e,
        stack: e?.stack
      });
      
      // Hata durumunu operationStatus'a yaz
      try {
        const statusRef = db.collection('operationStatus').doc(operationId);
        await statusRef.update({
          status: 'error',
          message: `Handler hatası: ${e?.message || e}`,
          endTime: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (statusError) {
        console.error('Status update failed:', statusError);
      }
    }
    return null;
  }
);
