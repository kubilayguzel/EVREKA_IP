// public/js/portfolio/TransactionHelper.js
import { db } from '../../firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class TransactionHelper {
    
    /**
     * Bir transaction için tüm ilişkili belgeleri (Kendi belgeleri + Task belgeleri) toplar.
     * @param {Object} transaction - İşlem verisi
     * @returns {Promise<Array>} - Normalize edilmiş belge listesi
     */
    static async getDocuments(transaction) {
        const docs = [];
        const seenUrls = new Set();

        // Belge ekleme yardımcısı (Duplicate önler)
        const addDoc = (d, source) => {
            const url = d.fileUrl || d.url || d.path || d.downloadURL;
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({
                    name: d.fileName || d.name || 'Belge',
                    url: url,
                    type: d.type || 'document',
                    source: source // 'direct' veya 'task' (renk ayrımı için)
                });
            }
        };

        // 1. Transaction üzerindeki direkt belgeler (Öncelikli)
        if (Array.isArray(transaction.documents)) {
            transaction.documents.forEach(d => addDoc(d, 'direct'));
        }
        
        // Özel alanlardaki belgeler
        if (transaction.relatedPdfUrl) {
            addDoc({ name: 'Resmi Yazı', url: transaction.relatedPdfUrl, type: 'official' }, 'direct');
        }
        if (transaction.oppositionPetitionFileUrl) {
            addDoc({ name: 'İtiraz Dilekçesi', url: transaction.oppositionPetitionFileUrl, type: 'petition' }, 'direct');
        }

        // 2. Task (Görev) üzerindeki belgeler (Fallback)
        // Eğer transaction bir Task tarafından tetiklendiyse (triggeringTaskId)
        if (transaction.triggeringTaskId) {
            try {
                const taskRef = doc(db, 'tasks', transaction.triggeringTaskId);
                const taskSnap = await getDoc(taskRef);
                
                if (taskSnap.exists()) {
                    const taskData = taskSnap.data();
                    
                    // ePats Belgesi
                    if (taskData.details?.epatsDocument?.downloadURL) {
                        addDoc({
                            name: taskData.details.epatsDocument.name || 'ePats Belgesi',
                            url: taskData.details.epatsDocument.downloadURL,
                            type: 'epats'
                        }, 'task');
                    }
                    
                    // Task Documents Array
                    if (Array.isArray(taskData.documents)) {
                        taskData.documents.forEach(d => addDoc(d, 'task'));
                    }
                }
            } catch (e) {
                console.warn(`Task belge çekme hatası (ID: ${transaction.triggeringTaskId}):`, e);
            }
        }

        return docs;
    }

    /**
     * Parent-Child ilişkisini kurar ve sıralar.
     */
    static organizeTransactions(transactions) {
        const parents = transactions.filter(t => t.transactionHierarchy === 'parent' || !t.parentId);
        const childrenMap = {};

        transactions.forEach(t => {
            if (t.parentId) {
                if (!childrenMap[t.parentId]) childrenMap[t.parentId] = [];
                childrenMap[t.parentId].push(t);
            }
        });

        // Tarihe göre sırala
        const sortByDate = (a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
        parents.sort(sortByDate);
        Object.values(childrenMap).forEach(list => list.sort(sortByDate));

        return { parents, childrenMap };
    }
}