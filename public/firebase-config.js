import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getAuth,
    signInWithEmailAndPassword,
    setPersistence,
    browserLocalPersistence,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

import { initializeFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, where, getDoc, setDoc, arrayUnion, writeBatch, documentId, serverTimestamp, Timestamp, FieldValue,
collectionGroup, limit, getDocsFromCache, getDocsFromServer, persistentLocalCache, persistentMultipleTabManager,onSnapshot }
from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { RecordMatcher } from './js/indexing/record-matcher.js';


// --- Firebase App Initialization ---
// 1. TEST/Geliştirme Ortamı (Mevcut projeniz)
const testConfig = {
  apiKey: "AIzaSyDbdqfiVbobnl1BtyiWxhD4bfIcREw8ZRc",
  authDomain: "ip-manager-production-aab4b.firebaseapp.com",
  projectId: "ip-manager-production-aab4b",
  storageBucket: "ip-manager-production-aab4b.firebasestorage.app",
  messagingSenderId: "594650169512",
  appId: "1:594650169512:web:43496005e063a40511829d",
  measurementId: "G-QY1P3ZCMC4"
};

// 2. CANLI/Production Ortamı (Yeni oluşturduğunuz proje)
const prodConfig = {
  apiKey: "AIzaSyAV2w2GJVm_gU7LtDW-GM1sFdroA0lroXw",
  authDomain: "ipgate-31bd2.firebaseapp.com",
  projectId: "ipgate-31bd2",
  storageBucket: "ipgate-31bd2.firebasestorage.app",
  messagingSenderId: "105921768418",
  appId: "1:105921768418:web:30e6240bcc635f1453a7bb",
  measurementId: "G-8JRJ0DLLRG"
};

const firebaseConfig = (
    window.location.hostname === "localhost" || 
    window.location.hostname === "127.0.0.1" || 
    window.location.hostname.includes("ip-manager-production-aab4b") ||
    window.location.hostname.includes("github.io") // GitHub Pages'i test ortamına dahil ettik
)
  ? testConfig 
  : prodConfig;

let app, auth, db, storage;
let isFirebaseAvailable = false;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    // 🔥 BU KOD BLOĞUNU EKLEYİN: Oturumu 'Local Storage'a sabitler
    // Böylece yeni sekme açıldığında oturum düşmez.
    setPersistence(auth, browserLocalPersistence)
        .then(() => {
            console.log("✅ Auth persistence set to LOCAL");
        })
        .catch((error) => {
            console.error("❌ Auth persistence error:", error);
        });

    db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    // experimentalForceLongPolling: true,   // gerekiyorsa aç
    useFetchStreams: false,
    // 🔒 IndexedDB kalıcı cache (ilk boyama için anında veri)
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    }),
    });
    storage = getStorage(app);
    isFirebaseAvailable = true;
    console.log('🔥 Firebase initialized successfully');
} catch (error) {
    console.error('⚠️ Firebase initialization failed:', error.message);
}

let functions;
if (isFirebaseAvailable) {
    functions = getFunctions(app, 'europe-west1'); // bölgen doğruysa bu
}


// --- Helper Functions & Constants ---
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export const subDesignationTranslations = {
    'opposition_to_publication': 'Yayına İtiraz',
    'response_to_opposition': 'İtiraza Karşı Görüş',
    'opposition_decision_rejected': 'Yayına İtiraz Kararı - Ret',
    'opposition_decision_accepted': 'Yayına İtiraz Kararı - Kabul'
};

export const documentDesignationTranslations = {
    'opposition_trademark_office': 'Yayına İtiraz - Markalar Dairesi',
    'Başvuru Ek Dokümanı': 'Başvuru Ek Dokümanı',
    'Resmi Yazışma': 'Resmi Yazışma',
    'Vekaletname': 'Vekaletname',
    'Teknik Çizim': 'Teknik Çizim',
    'Karar': 'Karar',
    'Finansal Belge': 'Finansal Belge',
    'Yayın Kararı': 'Yayın Kararı',
    'Ret Kararı': 'Ret Kararı',
    'Tescil Belgesi': 'Tescil Belgesi',
    'Araştırma Raporu': 'Araştırma Raporu',
    'İnceleme Raporu': 'İnceleme Raporu',
    'Diğer Belge': 'Diğer Belge',
    'Ödeme Dekontu': 'Ödeme Dekontu'
};

// --- Authentication Service ---
export const authService = {
    auth: auth,
    isFirebaseAvailable: isFirebaseAvailable,
    async getUserRole(uid) {
        if (!this.isFirebaseAvailable) {
            console.warn("Firebase kullanılamıyor, kullanıcı rolü yerel olarak alınamaz.");
            return null;
        }
        try {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (!userDoc.exists()) {
                console.warn(`Firestore'da ${uid} için kullanıcı belgesi bulunamadı. Varsayılan rol 'user' olarak atanıyor.`);
                return 'user';
            }
            return userDoc.data().role;
        } catch (error) {
            console.error("Kullanıcı rolü alınırken hata:", error);
            return null;
        }
    },
    async setUserRole(uid, email, displayName, role) {
        if (!this.isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor. Rol atanamaz." };
        try {
            await setDoc(doc(db, 'users', uid), {
                email, displayName, role,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }, { merge: true });
            return { success: true };
        } catch (error) {
            console.error("Kullanıcı rolü atanırken hata:", error);
            return { success: false, error: error.message };
        }
    },
    async signIn(email, password) {
        if (!isFirebaseAvailable) return this.localSignIn(email, password);
        try {
            const result = await signInWithEmailAndPassword(auth, email, password);
            const user = result.user;
            const role = await this.getUserRole(user.uid) || 'user';
            const userData = { uid: user.uid, email: user.email, displayName: user.displayName, role, isSuperAdmin: role === 'superadmin' };
            localStorage.setItem('currentUser', JSON.stringify(userData));
            return { success: true, user: userData, message: "Giriş başarılı!" };
        } catch (error) {
            let errorMessage = "Giriş başarısız oldu.";
            if (error.code) {
                switch (error.code) {
                    case 'auth/user-not-found':
                    case 'auth/wrong-password':
                        errorMessage = "Hatalı e-posta veya şifre.";
                        break;
                    case 'auth/invalid-email':
                        errorMessage = "Geçersiz e-posta adresi formatı.";
                        break;
                    case 'auth/user-disabled':
                        errorMessage = "Bu kullanıcı hesabı devre dışı bırakılmıştır.";
                        break;
                    default:
                        errorMessage = "Giriş sırasında bir hata oluştu: " + error.message;
                }
            }
            console.error("Giriş hatası:", error);
            return { success: false, error: errorMessage };
        }
    },
    async signUp(email, password, displayName, initialRole = 'belirsiz') {
    if (!isFirebaseAvailable) return this.localSignUp(email, password, displayName, initialRole);
    try {
        console.log('🔥 Firebase signUp starting:', { email, displayName }); // DEBUG
        const result = await createUserWithEmailAndPassword(auth, email, password);
        const user = result.user;
        console.log('👤 User created, updating profile with:', displayName); // DEBUG
        await updateProfile(user, { displayName });
        console.log('✅ Profile updated successfully'); // DEBUG
            const setRoleResult = await this.setUserRole(user.uid, email, displayName, initialRole);
            if (!setRoleResult.success) throw new Error(setRoleResult.error);
            
            const userData = { uid: user.uid, email, displayName, role: initialRole, isSuperAdmin: initialRole === 'superadmin' };
            localStorage.setItem('currentUser', JSON.stringify(userData));
            return { success: true, user: userData, message: "Kayıt başarılı!" };
        } catch (error) {
            let errorMessage = "Kayıt başarısız oldu.";
            if (error.code) {
                switch (error.code) {
                    case 'auth/email-already-in-use':
                        errorMessage = "Bu e-posta adresi zaten kullanımda.";
                        break;
                    case 'auth/invalid-email':
                        errorMessage = "Geçersiz e-posta adresi formatı.";
                        break;
                    case 'auth/weak-password':
                        errorMessage = "Şifre çok zayıf. En az 6 karakter olmalı.";
                        break;
                    default:
                        errorMessage = "Kayıt sırasında bir hata oluştu: " + error.message;
                }
            }
            console.error("Kayıt hatası:", error);
            return { success: false, error: errorMessage };
        }
    },
    async signOut() {
        if (isFirebaseAvailable) {
            try {
                await signOut(auth);
            } catch (error) {
                console.error("Firebase oturumu kapatılırken hata:", error);
            }
        }
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    },
    getCurrentUser() {
        const localData = localStorage.getItem('currentUser');
        return localData ? JSON.parse(localData) : null;
    },
    isSuperAdmin() {
        const user = this.getCurrentUser();
        return user?.role === 'superadmin';
    },
    localSignIn(email, password) {
        const accounts = [
            { email: 'demo@ipmanager.com', password: 'demo123', name: 'Demo User', role: 'user' },
            { email: 'admin@ipmanager.com', password: 'admin123', name: 'Admin User', role: 'admin' },
            { email: 'superadmin@ipmanager.com', password: 'superadmin123', name: 'Super Admin', role: 'superadmin' },
        ];
        const account = accounts.find(a => a.email === email && a.password === password);
        if (account) {
            const userData = { uid: `local_${Date.now()}`, email: account.email, displayName: account.name, role: account.role, isSuperAdmin: account.role === 'superadmin' };
            localStorage.setItem('currentUser', JSON.stringify(userData));
            return { success: true, user: userData, message: "Yerel giriş başarılı!" };
        }
        return { success: false, error: 'Hatalı yerel kimlik bilgileri.' };
    },
    localSignUp(email, password, displayName, initialRole = 'belirsiz') {
        const userData = { uid: `local_${Date.now()}`, email, displayName, role: initialRole, isSuperAdmin: initialRole === 'superadmin' };
        localStorage.setItem('currentUser', JSON.stringify(userData));
        return { success: true, user: userData, message: "Yerel kayıt başarılı!" };
    }
};

// --- IP Records Service ---
export const ipRecordsService = {
    async createRecord(recordData) {
        try {
            // 1. applicationNumber varsa duplikasyon kontrolü yap
            if (recordData.applicationNumber && recordData.applicationNumber.trim()) {
                const applicationNumber = recordData.applicationNumber.trim();
                
                // Aynı applicationNumber ile mevcut kayıt kontrolü
                const duplicateQuery = query(
                    collection(db, "ipRecords"),
                    where("applicationNumber", "==", applicationNumber)
                );
                
                const duplicateSnapshot = await getDocs(duplicateQuery);
                
                if (!duplicateSnapshot.empty) {
                    const existingRecord = duplicateSnapshot.docs[0].data();
                    const existingId = duplicateSnapshot.docs[0].id;
                    const existingOwnerType = existingRecord.recordOwnerType;
                    
                    console.log("🔍 Duplikasyon kontrolü:", {
                        applicationNumber,
                        newRecordType: recordData.recordOwnerType,
                        existingRecordType: existingOwnerType,
                        existingId,
                        createdFrom: recordData.createdFrom
                    });
                    
                    // KURAL 1: DATA ENTRY üzerinden kayıt (self veya third_party farketmez)
                    const isFromDataEntry = recordData.createdFrom === 'data_entry' || 
                                        !recordData.createdFrom; // Default olarak data entry kabul et
                    
                    if (isFromDataEntry) {
                        return { 
                            success: false, 
                            error: `Bu başvuru numarası (${applicationNumber}) ile zaten bir kayıt mevcut. Duplikasyon önlemek için kayıt oluşturulamadı.`,
                            isDuplicate: true,
                            existingRecordId: existingId,
                            existingRecordType: existingOwnerType
                        };
                    }
                    
                    // KURAL 2: İTİRAZ SONUCU oluşan 3. taraf kaydı
                    const isFromOpposition = recordData.createdFrom === 'opposition_automation' || 
                                        recordData.createdFrom === 'bulletin_record';
                    
                    if (isFromOpposition) {
                        console.log("✅ İtiraz sonucu - mevcut kayıt kullanılacak, yeni kayıt oluşturulmayacak");
                        return {
                        success: true,
                        id: existingId,               // bulunan kaydın id'si
                        isExistingRecord: true,
                        message: `Bu başvuru numarası (${applicationNumber}) zaten kayıtlı; mevcut kayıt kullanıldı.`
                        };
                    }
                    
                    // KURAL 3: Bilinmeyen durumlar için güvenli yaklaşım (duplikasyonu engelle)
                    return { 
                        success: false, 
                        error: `Bu başvuru numarası (${applicationNumber}) ile zaten bir kayıt mevcut.`,
                        isDuplicate: true,
                        existingRecordId: existingId,
                        existingRecordType: existingOwnerType
                    };
                }
            }
            
            // 2. Duplikasyon yoksa normal kayıt oluştur
            const docRef = await addDoc(collection(db, "ipRecords"), {
                ...recordData,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            
            console.log("✅ Yeni IP kaydı başarıyla oluşturuldu, ID:", docRef.id);
            return { success: true, id: docRef.id };
            
        } catch (error) {
            console.error("❌ IP kaydı oluşturulurken hata:", error);
            return { success: false, error: error.message };
        }
    },

    // Data Entry için özel metod (açık context ile)
    async createRecordFromDataEntry(recordData) {
        const recordDataWithContext = {
            ...recordData,
            createdFrom: 'data_entry'
        };
        
        return await this.createRecord(recordDataWithContext);
    },

    // İtiraz işi için özel metod (açık context ile)
    async createRecordFromOpposition(recordData) {
        const recordDataWithContext = {
            ...recordData,
            createdFrom: 'opposition_automation'
        };
        
        return await this.createRecord(recordDataWithContext);
    },
    async addRecord(record) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const docRef = await addDoc(collection(db, 'ipRecords'), { ...record, createdAt: new Date().toISOString() });
            return { success: true, id: docRef.id };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async getRecords(opts = {}) {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        const { limitCount } = opts;
        try {
        let q = query(collection(db, 'ipRecords'), orderBy('createdAt', 'desc'));
        if (limitCount) q = query(q, limit(limitCount));

        // 1) Cache'ten dene (IndexedDB)
        const snapCache = await getDocsFromCache(q).catch(() => null);
        if (snapCache && !snapCache.empty) {
            return { success: true, data: snapCache.docs.map(d => ({ id: d.id, ...d.data() })), from: 'cache' };
        }
        // 2) Sunucudan getir
        const snapServer = await getDocsFromServer(q).catch(() => getDocs(q));
        return { success: true, data: snapServer.docs.map(d => ({ id: d.id, ...d.data() })), from: 'server' };
        } catch (error) {
        return { success: false, error: error.message };
        }
    },

    async getRecordTransactions(recordId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor. İşlem geçmişi alınamaz." };
        try {
            const recordRef = doc(db, 'ipRecords', recordId);
            const transactionsCollectionRef = collection(recordRef, 'transactions');
            const q = query(transactionsCollectionRef, orderBy('timestamp', 'desc'));
            const querySnapshot = await getDocs(q);
            
            const transactions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return { success: true, data: transactions };
        } catch (error) {
            console.error("IP kaydı işlem geçmişi yüklenirken hata:", error);
            return { success: false, error: error.message };
        }
    },

    async getTransactionsForRecord(recordId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const transactionsRef = collection(db, 'ipRecords', recordId, 'transactions');
            const q = query(transactionsRef, orderBy('timestamp', 'asc')); 
            
            // DÜZELTME: Cache'i atla, veriyi sunucudan (Server) zorla getir
            const querySnapshot = await getDocsFromServer(q); 
            
            const transactions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return { success: true, transactions: transactions };
        } catch (error) {
            console.error("Kayda ait transaction'lar getirilirken hata:", error);
            return { success: false, error: error.message };
        }
    },

    async getRecordById(recordId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const docRef = doc(db, "ipRecords", recordId);
            const docSnap = await getDoc(docRef);
            return docSnap.exists() ? { success: true, data: { id: docSnap.id, ...docSnap.data() } } : { success: false, error: "Kayıt bulunamadı." };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    async updateRecord(recordId, updates) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            await updateDoc(doc(db, 'ipRecords', recordId), { ...updates, updatedAt: new Date().toISOString() });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async deleteRecord(recordId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        
        try {
            // ✅ ÖNCE: Alt koleksiyondaki transaction'ları sil
            const recordRef = doc(db, 'ipRecords', recordId);
            const transactionsRef = collection(recordRef, 'transactions');
            
            // Tüm transaction'ları getir
            const transactionsSnapshot = await getDocs(transactionsRef);
            
            // Her transaction'ı tek tek sil
            const deletePromises = transactionsSnapshot.docs.map(transactionDoc => 
                deleteDoc(transactionDoc.ref)
            );
            
            // Tüm transaction'ların silinmesini bekle
            await Promise.all(deletePromises);
            
            console.log(`✅ ${deletePromises.length} transaction silindi`);
            
            // ✅ SONRA: Ana kayıt silme
            await deleteDoc(recordRef);
            
            console.log('✅ Portfolio kaydı ve tüm transaction\'ları silindi');
            return { success: true };
            
        } catch (error) {
            console.error('❌ Kayıt silme hatası:', error);
            return { success: false, error: error.message };
        }
    },

    // ✅ YENİ EKLENECEK FONKSİYON: Parent ve Child'ları birlikte siler
    async deleteParentWithChildren(parentId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };

        try {
            console.log(`🗑️ Cascading Delete başlatılıyor. Parent ID: ${parentId}`);

            // 1. Önce bu Parent'a bağlı Child kayıtları bul
            // TransactionHierarchy kontrolü ile sadece 'child' olanları seçiyoruz
            const childQuery = query(
                collection(db, 'ipRecords'),
                where('parentId', '==', parentId),
                where('transactionHierarchy', '==', 'child')
            );

            const childSnapshot = await getDocs(childQuery);

            // 2. Bulunan Child kayıtları sil
            // Not: Burada 'this.deleteRecord' çağırıyoruz ki child'ın altındaki transaction'lar da temizlensin.
            const deleteChildPromises = childSnapshot.docs.map(doc => this.deleteRecord(doc.id));
            
            await Promise.all(deleteChildPromises);
            console.log(`✅ ${childSnapshot.size} adet alt kayıt (child) başarıyla silindi.`);

            // 3. Son olarak Ana Kaydı (Parent) sil
            const result = await this.deleteRecord(parentId);

            return result;

        } catch (error) {
            console.error('❌ Toplu silme işlemi sırasında hata:', error);
            return { success: false, error: error.message };
        }
    },
    
    // ipRecordsService içine ekle
    async getObjectionParents(limitCount = 50) {
    if (!isFirebaseAvailable) return { success: true, data: [] };
    try {
        const TYPES = [7, 19, 20]; // ebeveyn itiraz/yanıt/karar tipleri
        let q = query(
        collectionGroup(db, 'transactions'),
        where('type', 'in', TYPES),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
        );
        // Cache -> Server stratejisi
        const snapCache = await getDocsFromCache(q).catch(() => null);
        const snap = (snapCache && !snapCache.empty) ? snapCache : await getDocs(q);
        const items = snap.docs.map(d => {
        const data = d.data();
        const recordRef = d.ref.parent.parent;   // ilgili ipRecords/{recordId}
        return { id: d.id, recordId: recordRef.id, ...data };
        });
        return { success: true, data: items };
    } catch (error) {
        // İlk seferde index isteyebilir; konsol linkinden oluştur.
        console.error('getObjectionParents error:', error);
        return { success: false, error: error.message, data: [] };
    }
    },

    // public/firebase-config.js  (ipRecordsService içinde)
    async addTransactionToRecord(recordId, transactionData) {
    if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
    try {
        const recordRef = doc(db, 'ipRecords', recordId);
        const transactionsCollectionRef = collection(recordRef, 'transactions');

        const currentUser = auth.currentUser;
        const userName = currentUser?.displayName || currentUser?.email || 'anonymous';

        const transactionToAdd = {
        ...transactionData,
        ...(transactionData.triggeringTaskId ? { triggeringTaskId: String(transactionData.triggeringTaskId) } : {}),
        timestamp: new Date().toISOString(),
        userId: currentUser ? currentUser.uid : 'anonymous',
        userEmail: currentUser ? currentUser.email : 'anonymous@example.com',
        userName
        };

        const docRef = await addDoc(transactionsCollectionRef, transactionToAdd);
        return { success: true, id: docRef.id, data: transactionToAdd };
    } catch (error) {
        console.error("Transaction alt koleksiyona eklenirken hata:", error);
        return { success: false, error: error.message };
    }
    }
    ,
    async addFileToRecord(recordId, fileData) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const recordRef = doc(db, 'ipRecords', recordId);
            const user = authService.getCurrentUser();
            const userEmail = user ? user.email : 'anonymous@example.com';
            const newFile = {
                ...fileData,
                id: generateUUID(),
                uploadedAt: new Date().toISOString(),
                userEmail: userEmail
            };
            await updateDoc(recordRef, { files: arrayUnion(newFile) });
            return { success: true, data: newFile };
        } catch (error) {
            console.error("Error in addFileToRecord:", error);
            return { success: false, error: error.message };
        }
    },
    async searchRecords(searchTerm) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        if (!searchTerm || searchTerm.trim().length < 3) return { success: true, data: [] };

        try {
            const termRaw = searchTerm.trim();
            const term = termRaw.toLowerCase();
            
            // ÖNCE: Numaralar ile Tam Eşleşme Sorguları (Çok Hızlıdır)
            // Not: Firestore OR sorgusu olmadığından sırayla deneriz.
            const exactFields = ['applicationNumber', 'applicationNo', 'wipoIR', 'aripoIR', 'dosyaNo', 'fileNo'];
            for (const field of exactFields) {
                try {
                    const qExact = query(collection(db, 'ipRecords'), where(field, '==', termRaw), limit(5));
                    const snapExact = await getDocs(qExact);
                    if (!snapExact.empty) {
                        return { success: true, data: snapExact.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
                    }
                } catch (e) {
                    // Bazı alanlar şema dışı olabilir ya da index/permission sorunları yaşanabilir; sessizce devam et.
                }
            }

            // SONRA: Eğer numara değilse, mevcut "fetch 500" mantığını 
            // Cache'i zorlayarak (daha önce indiyse anında gelir) çalıştırın.
            const q = query(collection(db, 'ipRecords'), orderBy('createdAt', 'desc'), limit(500));
            
            // getDocsFromCache kullanımı hızı inanılmaz artırır
            let snapshot;
            try {
                snapshot = await getDocsFromCache(q);
                if (snapshot.empty) snapshot = await getDocs(q);
            } catch (e) {
                snapshot = await getDocs(q);
            }
            
            const results = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                const title = (data.title || data.markName || '').toLowerCase();
                const nos = [
                    data.applicationNumber,
                    data.applicationNo,
                    data.wipoIR,
                    data.aripoIR,
                    data.dosyaNo,
                    data.fileNo
                ].filter(Boolean).map(v => String(v).toLowerCase());

                const noHit = nos.some(v => v.includes(term));

                if (title.includes(term) || noHit) {
                    results.push({ id: doc.id, ...data });
                }
            });

            return { success: true, data: results.slice(0, 20) }; // Sadece ilk 20 sonucu dönmek yeterli
        } catch (error) {
            console.error("Kayıt arama hatası:", error);
            return { success: false, error: error.message };
        }
    },

// Varsayılan değeri null yapıyoruz ki herhangi bir sayı verilmezse sınır koymasın
    subscribeToRecords(callback, limitCount = null) {
        if (!isFirebaseAvailable) return () => {};
        
        // Temel sorguyu oluştur
        let q = query(collection(db, 'ipRecords'), orderBy('createdAt', 'desc'));
        
        // SADECE eğer limitCount geçerli bir sayı olarak verilmişse limit ekle
        if (limitCount && typeof limitCount === 'number') {
            q = query(q, limit(limitCount));
        }
        
        return onSnapshot(q, (snapshot) => {
            const records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback({ success: true, data: records });
        }, (error) => {
            console.error("Firestore Dinleme Hatası:", error.code, error.message);
            if (error.code === 'permission-denied') {
                console.warn("Geçici yetki kaybı, dinleyici korunuyor.");
                return;
            }
            callback({ success: false, error: error.message });
        });
    }

};

// --- YENİ EKLENDİ: Persons Service ---
export const personService = {
    async getPersons() {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        try {
            const q = query(collection(db, 'persons'), orderBy('name', 'asc'));
            const querySnapshot = await getDocs(q);
            return { success: true, data: querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async addPerson(personData) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const id = generateUUID();
            const newPerson = {
                ...personData,
                id,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'persons', id), newPerson);
            return { success: true, data: newPerson };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async updatePerson(personId, updates) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            await updateDoc(doc(db, 'persons', personId), { ...updates, updatedAt: new Date().toISOString() });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async deletePerson(personId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            // İlişkili kullanıcılar varsa önce onları temizle
            await this.removePersonFromAllUsers(personId);
            await deleteDoc(doc(db, 'persons', personId));
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    // --- YENİ: Kullanıcı-Kişi İlişkilendirme Fonksiyonları ---
    async linkUserToPersons(userId, personsWithPermissions) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, {
                linkedPersons: Array.isArray(personsWithPermissions) ? personsWithPermissions : [],
                // Geriye uyumluluk için eski alanı da güncelle
                linkedPersonIds: personsWithPermissions.map(p => p.personId),
                updatedAt: new Date().toISOString()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
   async getLinkedPersons(userId) {
    if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (!userDoc.exists()) {
            return { success: true, data: [] };
        }
        
        const userData = userDoc.data();
        
        // Önce yeni format kontrol et
        if (userData.linkedPersons && Array.isArray(userData.linkedPersons)) {
            const linkedPersons = userData.linkedPersons;
            if (linkedPersons.length === 0) {
                return { success: true, data: [] };
            }
            
            // Kişi bilgilerini getir ve yetki bilgileriyle birleştir
            const personPromises = linkedPersons.map(async (link) => {
                const personDoc = await getDoc(doc(db, 'persons', link.personId));
                if (personDoc.exists()) {
                    return {
                        id: personDoc.id,
                        ...personDoc.data(),
                        permissions: link.permissions || { type: 'view' }
                    };
                }
                return null;
            });
            
            const persons = (await Promise.all(personPromises)).filter(p => p !== null);
            return { success: true, data: persons };
        }
        
        // Eski format için geriye dönük uyumluluk
        if (userData.linkedPersonIds && Array.isArray(userData.linkedPersonIds)) {
            const personIds = userData.linkedPersonIds;
            if (personIds.length === 0) {
                return { success: true, data: [] };
            }
            
            const personPromises = personIds.map(id => getDoc(doc(db, 'persons', id)));
            const personDocs = await Promise.all(personPromises);
            
            const persons = personDocs
                .filter(doc => doc.exists())
                .map(doc => ({ 
                    id: doc.id, 
                    ...doc.data(),
                    permissions: { approval: true, view: true } // Eski kayıtlar için varsayılan
                }));
            
            return { success: true, data: persons };
        }
        
        return { success: true, data: [] };
    } catch (error) {
        return { success: false, error: error.message };
    }
},

    async unlinkUserFromAllPersons(userId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, {
                linkedPersons: [],
                linkedPersonIds: [], // Geriye uyumluluk
                updatedAt: new Date().toISOString()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    async getUsersLinkedToPerson(personId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const q = query(collection(db, 'users'), where('linkedPersonIds', 'array-contains', personId));
            const querySnapshot = await getDocs(q);
            return { 
                success: true, 
                data: querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    async removePersonFromAllUsers(personId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const q = query(collection(db, 'users'), where('linkedPersonIds', 'array-contains', personId));
            const querySnapshot = await getDocs(q);
            
            const batch = writeBatch(db);
            querySnapshot.docs.forEach(userDoc => {
                const userData = userDoc.data();
                const currentPersonIds = userData.linkedPersonIds || [];
                const updatedPersonIds = currentPersonIds.filter(id => id !== personId);
                
                batch.update(userDoc.ref, { 
                    linkedPersonIds: updatedPersonIds,
                    updatedAt: new Date().toISOString()
                });
            });
            
            await batch.commit();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};
// --- YENİ EKLENDİ: Monitoring Service ---
export const monitoringService = {
    async addMonitoringItem(record) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            // Kontrol: Zaten izleniyor mu?
            const docRef = doc(db, 'monitoringTrademarks', record.id);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                console.log("🔍 İzleme kaydı zaten mevcut, güncelleniyor:", record.id);
                
                await updateDoc(docRef, {
                    ...record,
                    updatedAt: new Date().toISOString()
                });

            } else {
                console.log("✅ Yeni izleme kaydı oluşturuluyor:", record.id);

                await setDoc(docRef, {
                    ...record,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }

            return { success: true };

        } catch (error) {
            console.error("İzleme kaydı eklenirken hata:", error);
            return { success: false, error: error.message };
        }
    },

    async removeMonitoringItem(recordId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const ref = doc(db, 'monitoringTrademarks', recordId);
            await deleteDoc(ref);
            return { success: true };
        } catch (error) {
            console.error("İzleme kaydı silinirken hata:", error);
            return { success: false, error: error.message };
        }
    },

    async getMonitoringItems() {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        try {
            const q = query(
                collection(db, 'monitoringTrademarks'),
                orderBy('updatedAt', 'desc')
            );
            const snapshot = await getDocs(q);
            
            return { 
                success: true, 
                data: snapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    ...doc.data() 
                })) 
            };
        } catch (error) {
            console.error("İzleme kayıtları alınırken hata:", error);
            return { success: false, error: error.message, data: [] };
        }
    },

    updateMonitoringItem: async (docId, data) => {
        try {
        const docRef = doc(db, "monitoringTrademarks", docId);
        await updateDoc(docRef, data);
        return { success: true };
        } catch (error) {
        return { success: false, error: error.message };
        }
    },

    // Bonus: Bir kaydın izlenip izlenmediğini kontrol etmek için
    async isMonitored(recordId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const docSnap = await getDoc(doc(db, 'monitoringTrademarks', recordId));
            return { success: true, isMonitored: docSnap.exists() };
        } catch (error) {
            console.error("İzleme durumu kontrol edilirken hata:", error);
            return { success: false, error: error.message };
        }
    }
};

// --- YENİ EKLENDİ: Task Service ---
export const taskService = {
    async createTask(taskData) { 
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        const user = authService.getCurrentUser();
        try {
            const id = await getNextTaskId();
            const newTask = {
                ...taskData,
                id,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: { uid: user.uid, email: user.email },
                history: [{
                    timestamp: new Date().toISOString(),
                    action: 'İş oluşturuldu.',
                    userEmail: user.email
                }]
            };

            if (newTask.officialDueDate instanceof Date) {
                newTask.officialDueDate = Timestamp.fromDate(newTask.officialDueDate);
            }

            await setDoc(doc(db, "tasks", id), newTask);
            return { success: true, id };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async getAllTasks() {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        try {
            const q = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);
            return { success: true, data: querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    },
    async getTaskById(taskId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const docRef = doc(db, "tasks", taskId);
            const docSnap = await getDoc(docRef);
            return docSnap.exists() ? { success: true, data: { id: docSnap.id, ...docSnap.data() } } : { success: false, error: "Görev bulunamadı." };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async getTasksForUser(userId) {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        try {
            const q = query(collection(db, "tasks"), where("assignedTo_uid", "==", userId), orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);
            return { success: true, data: querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async updateTask(taskId, updates) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        const user = authService.getCurrentUser();
        try {
            const taskRef = doc(db, "tasks", taskId);
            const newHistoryEntry = {
                timestamp: new Date().toISOString(),
                action: `İş güncellendi. Değişen alanlar: ${Object.keys(updates).join(', ')}`,
                userEmail: user.email
            };

            if (updates.officialDueDate instanceof Date) {
                updates.officialDueDate = Timestamp.fromDate(updates.officialDueDate);
            }

            await updateDoc(taskRef, {
                ...updates,
                updatedAt: new Date().toISOString(),
                history: arrayUnion(newHistoryEntry)
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async deleteTask(taskId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            await deleteDoc(doc(db, "tasks", taskId));
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async reassignTasks(taskIds, newUserId, newUserEmail) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        const user = authService.getCurrentUser();
        const batch = writeBatch(db);
        try {
            taskIds.forEach(id => {
                const taskRef = doc(db, "tasks", id);
                const historyEntry = {
                    timestamp: new Date().toISOString(),
                    action: `İş, ${newUserEmail} kullanıcısına atandı.`,
                    userEmail: user.email
                };
                batch.update(taskRef, {
                    assignedTo_uid: newUserId,
                    assignedTo_email: newUserEmail,
                    updatedAt: new Date().toISOString(),
                    history: arrayUnion(historyEntry)
                });
            });
            await batch.commit();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async getAllUsers() {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        try {
            const querySnapshot = await getDocs(collection(db, "users"));
            return { success: true, data: querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};
// --- YENİ EKLENDİ: Transaction Type Service ---
export const transactionTypeService = {
    collectionRef: collection(db, 'transactionTypes'),

    async addTransactionType(typeData) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor. İşlem tipi eklenemez." };
        try {
            const id = typeData.id || generateUUID(); 
            const newType = {
                ...typeData,
                id,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            await setDoc(doc(this.collectionRef, id), newType);
            return { success: true, data: newType };
        } catch (error) {
            console.error("İşlem tipi eklenirken hata:", error);
            return { success: false, error: error.message };
        }
    },

    async getTransactionTypes() {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        try {
            const q = query(this.collectionRef, orderBy('name', 'asc'));
            const querySnapshot = await getDocs(q);
            return { success: true, data: querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
        } catch (error) {
            console.error("İşlem tipleri yüklenirken hata:", error);
            return { success: false, error: error.message, data: [] };
        }
    },

    async getTransactionTypeById(typeId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const docRef = doc(this.collectionRef, typeId);
            const docSnap = await getDoc(docRef);
            return docSnap.exists() ? { success: true, data: { id: docSnap.id, ...docSnap.data() } } : { success: false, error: "İşlem tipi bulunamadı." };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    async getFilteredTransactionTypes(filters = {}) {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        try {
            let q = this.collectionRef;

            if (filters.hierarchy) {
                q = query(q, where('hierarchy', '==', filters.hierarchy));
            }
            if (filters.ipType) {
                q = query(q, where('applicableToMainType', 'array-contains', filters.ipType));
            }
            if (filters.ids && filters.ids.length > 0) {
                q = query(q, where(documentId(), 'in', filters.ids));
            }

            q = query(q, orderBy('name', 'asc')); 

            const querySnapshot = await getDocs(q);
            return { success: true, data: querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
        } catch (error) {
            console.error("Filtrelenmiş işlem tipleri yüklenirken hata:", error);
            return { success: false, error: error.message, data: [] };
        }
    },

    async updateTransactionType(typeId, updates) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor. İşlem tipi güncellenemez." };
        try {
            await updateDoc(doc(this.collectionRef, typeId), { ...updates, updatedAt: new Date().toISOString() });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    async deleteTransactionType(typeId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor. İşlem tipi silinemez." };
        try {
            await deleteDoc(doc(this.collectionRef, typeId));
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};

// Tahakkuk ID counter fonksiyonu
async function getNextAccrualId() {
    if (!isFirebaseAvailable) return '1';

    try {
        const counterRef = doc(db, 'counters', 'accruals');

        const counterDoc = await getDoc(counterRef);

        let currentId = 0;

        if (counterDoc.exists()) {
            const data = counterDoc.data();
            if (data && typeof data.lastId === 'number') {
                currentId = data.lastId;
            }
        } else {
            await setDoc(counterRef, { lastId: 0 });
            currentId = 0;
        }

        const nextId = currentId + 1;

        await setDoc(counterRef, { lastId: nextId }, { merge: true });

        return nextId.toString();

    } catch (error) {
        console.error('🔥 Tahakkuk ID üretim hatası:', error);
        return 'error';
    }
}
export async function getNextTaskId() {
    if (!isFirebaseAvailable) return '1';

    try {
        const counterRef = doc(db, 'counters', 'tasks');
        const counterDoc = await getDoc(counterRef);

        let currentId = 0;

        if (counterDoc.exists()) {
            const data = counterDoc.data();
            if (data && typeof data.lastId === 'number') {
                currentId = data.lastId;
            }
        } else {
            await setDoc(counterRef, { lastId: 0 });
            currentId = 0;
        }

        const nextId = currentId + 1;
        await setDoc(counterRef, { lastId: nextId }, { merge: true });

        return nextId.toString();
    } catch (error) {
        console.error('🔥 Task ID üretim hatası:', error);
        return 'error';
    }
}

// --- Accrual Service ---
export const accrualService = {
    async addAccrual(accrualData) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor. Tahakkuk eklenemez." };
        const user = authService.getCurrentUser();
        if (!user) return { success: false, error: "Kullanıcı girişi yapılmamış." };
        
        try {
            const accrualId = await getNextAccrualId();
            // Determine task title based on task's type alias
            let computedTaskTitle = accrualData.taskTitle;
            try {
            if (accrualData.taskId) {
                const taskSnap = await getDoc(doc(db, 'tasks', String(accrualData.taskId)));
                if (taskSnap.exists()) {
                const tdata = taskSnap.data();
                // task type id için birkaç muhtemel alan adı
                const typeId = tdata?.specificTaskType || tdata?.taskTypeId || tdata?.type || tdata?.specificType;
                if (typeId) {
                    const typeSnap = await getDoc(doc(db, 'transactionTypes', String(typeId)));
                    if (typeSnap.exists()) {
                    const td = typeSnap.data();
                    // alias varsa onu, yoksa name’i kullan
                    computedTaskTitle = td?.alias || td?.name || computedTaskTitle;
                    }
                }
                }
            }
            } catch (e) {
            console.warn('Task type alias lookup failed:', e?.message || e);
            }

            const newAccrual = {
                ...accrualData,
                taskTitle: computedTaskTitle,
                id: accrualId, 
                status: 'unpaid',
                createdAt: new Date().toISOString(),
                createdBy_uid: user.uid,
                createdBy_email: user.email,
                files: (accrualData.files || []).map(f => ({ ...f, id: f.id || generateUUID() })),
                paymentDate: null
            };
            await setDoc(doc(db, 'accruals', accrualId), newAccrual); 
            return { success: true, data: newAccrual };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async getAccruals() {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        try {
            const q = query(collection(db, 'accruals'), orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);
            return { success: true, data: querySnapshot.docs.map(d => ({id: d.id, ...d.data()})) };
        } catch (error) {
            return { success: false, error: error.message, data: [] };
        }
    },
    async getAccrualsByTaskId(taskId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const q = query(collection(db, 'accruals'), where('taskId', '==', taskId), orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);
            return { success: true, data: querySnapshot.docs.map(d => ({id: d.id, ...d.data()})) };
        } catch (error) {
            return { success: false, error: error.message, data: [] };
        }
    },
    async updateAccrual(accrualId, updates) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor. Tahakkuk güncellenemez." };
        try {
            const accrualRef = doc(db, 'accruals', accrualId);
            const currentAccrualDoc = await getDoc(accrualRef);
            if (!currentAccrualDoc.exists()) {
                return { success: false, error: "Tahakkuk bulunamadı." };
            }
            const finalUpdates = { ...updates, updatedAt: new Date().toISOString() };
            await updateDoc(accrualRef, finalUpdates);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    async deleteAccrual(accrualId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor. Tahakkuk silinemez." };
        try {
            await deleteDoc(doc(db, 'accruals', accrualId));
            return { success: true };
        } catch (error) {
            console.error("Tahakkuk silme hatası:", error);
            return { success: false, error: error.message };
        }
    }
};

// --- Demo Data Function ---
export async function createDemoData() {
    console.log('🧪 Demo verisi oluşturuluyor...');
    const user = authService.getCurrentUser();
    if (!user) {
        console.error('Demo verisi oluşturmak için kullanıcı girişi yapılmamış.');
        return;
    }

    try {
        const demoPersonEmail = `demo.owner.${Date.now()}@example.com`;
        const demoPerson = {
            personType: 'real',
            firstName: 'Demo',
            lastName: 'Hak Sahibi',
            name: 'Demo Hak Sahibi',
            email: demoPersonEmail,
            phone: '0555 123 4567',
            address: 'Demo Adres, No:1, İstanbul',
            country: 'Türkiye',
            city: 'İstanbul'
        };
        const personResult = await personService.addPerson(demoPerson); 
        if (!personResult.success) {
            console.error("Demo kişi oluşturulamadı:", personResult.error);
            return;
        }
        const demoOwner = { 
            id: personResult.data.id, 
            name: personResult.data.name, 
            personType: personResult.data.personType,
            email: demoPersonEmail 
        };

        const demoRecords = [
            {
                type: 'patent',
                title: 'Otomatik Patent Başvurusu',
                applicationNumber: 'TR2023/P12345',
                applicationDate: '2023-01-15',
                status: 'pending',
                description: 'Bu bir demo patent başvurusudur.',
                patentClass: 'A01B',
                owners: [demoOwner],
                recordStatus: 'aktif'
            },
            {
                type: 'trademark',
                title: 'Yaratıcı Marka Tescili',
                applicationNumber: 'TR2023/M67890',
                applicationDate: '2023-03-20',
                status: 'registered',
                description: 'Bu bir demo marka tescilidir.',
                niceClass: '01,05',
                owners: [demoOwner],
                recordStatus: 'aktif',
                trademarkImage: 'https://via.placeholder.com/150/FF0000/FFFFFF?text=Marka' 
            },
            {
                type: 'copyright',
                title: 'Dijital Sanat Eseri Telif',
                applicationDate: '2023-05-10',
                status: 'active',
                description: 'Demo telif hakkı kaydı.',
                workType: 'Resim',
                owners: [demoOwner],
                recordStatus: 'aktif'
            },
            {
                type: 'design',
                title: 'Yenilikçi Ürün Tasarımı',
                applicationNumber: 'TR2023/D11223',
                applicationDate: '2023-07-01',
                status: 'approved',
                description: 'Demo tasarım kaydı.',
                designClass: '01.01',
                owners: [demoOwner],
                recordStatus: 'aktif'
            }
        ];

        for (const recordData of demoRecords) {
            const addRecordResult = await ipRecordsService.addRecord(recordData);
            if (!addRecordResult.success) {
                console.error("Demo kayıt oluşturulamadı:", recordData.title, addRecordResult.error);
                continue;
            }
            const newRecordId = addRecordResult.id;

            const applicationTransactionType = transactionTypeService.getTransactionTypes().then(result => {
                if (result.success) {
                    return result.data.find(type => 
                        type.hierarchy === 'parent' && 
                        type.alias === 'Başvuru' && 
                        type.applicableToMainType.includes(recordData.type)
                    );
                }
                return null;
            });

            const initialTransaction = await applicationTransactionType;

            if (initialTransaction) {
                const initialTransactionData = {
                    type: initialTransaction.id, 
                    designation: initialTransaction.alias || initialTransaction.name, 
                    description: `Yeni ${recordData.type} kaydı için başlangıç başvurusu.`,
                    timestamp: new Date(recordData.applicationDate).toISOString(), 
                    transactionHierarchy: 'parent'
                };
                await ipRecordsService.addTransactionToRecord(newRecordId, initialTransactionData);
                console.log(`İlk 'Başvuru' işlemi ${recordData.title} kaydına eklendi.`);
            } else {
                console.warn(`'${recordData.type}' için uygun 'Başvuru' işlem tipi bulunamadı. İlk işlem eklenemedi.`);
            }
        }

        console.log('✅ Demo verisi başarıyla oluşturuldu!');

    } catch (error) {
        console.error('Demo verisi oluşturulurken hata:', error);
    }
}

// --- Bulk Indexing Service ---
// YENİ EKLENDİ: bulkIndexingService tanımı
export const bulkIndexingService = {
    // collectionRef: collection(db, 'pendingBulkIndexJobs'), // Bu koleksiyonun adını 'unindexed_pdfs' olarak değiştireceğiz
    // NOT: bulk-indexing-module.js içinde UNINDEXED_PDFS_COLLECTION sabitini kullanıyoruz.
    // Bu servis buraya tam olarak taşınmışsa, collectionRef'i doğrudan kullanabiliriz.
    // Ancak bu servis artık kullanılmayacaksa, bu tanımı da kaldırabiliriz.
    // Şimdilik, daha önceki haliyle geri getiriyorum, hata düzelince karar veririz.

    collectionRef: collection(db, 'pendingBulkIndexJobs'), // Önceki tanımına geri döndürüldü

    async addJob(jobData) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        const currentUser = authService.getCurrentUser();
        if (!currentUser) return { success: false, error: "Kullanıcı girişi yapılmamış." };

        const newJob = { ...jobData, createdAt: new Date().toISOString(), userId: currentUser.uid, userEmail: currentUser.email };
        try {
            await setDoc(doc(this.collectionRef, jobData.jobId), newJob);
            return { success: true, data: newJob };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async getPendingJobs(userId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor.", data: [] };
        try {
            const q = query(this.collectionRef, where('userId', '==', userId), orderBy('createdAt', 'asc'));
            const snapshot = await getDocs(q);
            return { success: true, data: snapshot.docs.map(d => ({ jobId: d.id, ...d.data() })) };
        } catch (error) {
            return { success: false, error: error.message, data: [] };
        }
    },
    async updateJob(jobId, updates) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            await updateDoc(doc(this.collectionRef, jobId), updates);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async deleteJob(jobId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            await deleteDoc(doc(this.collectionRef, jobId));
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    },
};

// === ETEBS SERVICE LAYER ===
// firebase-config.js dosyasının sonuna eklenecek

// firebase-config.js dosyasında ETEBS_CONFIG'i bulun ve şöyle güncelleyin:

// ETEBS API Configuration - Firebase Functions Proxy kullanıyor
const ETEBS_CONFIG = {
  proxyUrl: 'https://etebsproxyv2-jzwp32xwma-ew.a.run.app',
  healthUrl: 'https://etebsproxyhealthv2-jzwp32xwma-ew.a.run.app',
  validateUrl: 'https://validateetebstokenv2-jzwp32xwma-ew.a.run.app',

  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000
};

// ETEBS Error Codes (Gerekli)
const ETEBS_ERROR_CODES = {
    '001': 'Eksik Parametre',
    '002': 'Hatalı Token',
    '003': 'Sistem Hatası',
    '004': 'Hatalı Evrak Numarası',
    '005': 'Daha Önce İndirilmiş Evrak',
    '006': 'Evraka Ait Ek Bulunamadı'
};

// ETEBS Service
export const etebsService = {
    // Token validation (Aynı kalır)
    validateToken(token) {
        if (!token || typeof token !== 'string') {
            return { valid: false, error: 'Token gerekli' };
        }
        const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!guidRegex.test(token)) {
            return { valid: false, error: 'Geçersiz token formatı' };
        }
        return { valid: true };
    },

    // GÜNCELLENMİŞ: Tüm Batch İşlemini Başlatan Metot
    getDailyNotifications: async function(token) {
        try {
            const currentUser = authService.getCurrentUser();
            if (!currentUser) {
                return { success: false, error: 'Kullanıcı kimliği doğrulanamadı.' };
            }
            
            console.log("🔥 [ETEBŞ] Batch indirme işlemi Cloud Function üzerinden başlatılıyor...");

            const response = await fetch(ETEBS_CONFIG.proxyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'process-daily-batch', // YENİ ACTION: Tüm listeyi çek ve kalıcı kaydet
                    token: token,
                    userId: currentUser.uid // Sunucunun dosya yolunu belirlemesi için
                }),
                timeout: ETEBS_CONFIG.timeout
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error("❌ ETEBS API HTTP hatası:", response.status, errorData.message);
                return { success: false, error: `ETEBS API bağlantısı başarısız: ${response.status} - ${errorData.message || 'Sunucu hatası'}` };
            }

            const result = await response.json();
            
            if (!result.success || !result.data) {
                return { success: false, error: result.error || 'Batch işlemi başarısız oldu.' };
            }

            const batchData = result.data;
            const notifications = batchData.notifications || [];
            const savedDocuments = batchData.savedDocuments || [];
            
            // 1. Yeni Listeyi Oluştur ve Eşleştirme yap
            const processedNotifications = await this.processNotifications(notifications, currentUser.uid);

            // 2. Kaydedilen evrak ID'lerini eşleştir
            const savedMap = new Map(savedDocuments.map(d => [d.evrakNo, d]));
            
            const finalNotifications = processedNotifications.map(n => {
                const savedDoc = savedMap.get(n.evrakNo);
                return {
                    ...n,
                    isSaved: !!savedDoc, // Kalıcı olarak kaydedildi mi?
                    savedDocument: savedDoc || null,
                    // Eğer kaydedilmişse, unindexedPdfId'yi ekle (UI'da yönlendirme için kullanılır)
                    unindexedPdfId: savedDoc?.unindexedPdfId || savedDoc?.id || null 
                };
            });

            const matchedCount = finalNotifications.filter(n => n.matched).length;
            const unmatchedCount = finalNotifications.length - matchedCount;
            const savedCount = finalNotifications.filter(n => n.isSaved).length;

            // Sonuçları döndür
            return {
                success: true,
                data: finalNotifications,
                totalCount: finalNotifications.length,
                matchedCount,
                unmatchedCount,
                savedCount,
                failureCount: batchData.failures.length,
                failures: batchData.failures
            };

        } catch (error) {
            console.error("🔥 getDailyNotifications (Batch) hata:", error);
            return { success: false, error: 'Batch servisine bağlanırken beklenmeyen bir hata oluştu.' };
        }
    },

    // public/firebase-config.js içinde ilgili fonksiyonu bul ve değiştir:

async getRecentUnindexedDocuments(limitCount = 50) {
    try {
        const database = window.db || this.db || db;
        if (!database) return [];

        const pdfsRef = collection(database, 'unindexed_pdfs');
        const q = query(pdfsRef, orderBy('uploadedAt', 'desc'), limit(limitCount));
        const querySnapshot = await getDocs(q);

        // HATA DÜZELTME: ipRecordsService içinde 'getAllRecords' yok, 'getRecords' var.
        const allRecordsResult = await ipRecordsService.getRecords(); 
        const portfolioRecords = allRecordsResult.success ? allRecordsResult.data : [];
        
        // Matcher sınıfını kullan
        const matcher = new RecordMatcher();
        const documents = [];

        querySnapshot.forEach((d) => {
            const data = d.data();
            
            // Anlık Eşleştirme
            const searchKey = data.dosyaNo || data.evrakNo;
            let matchedData = { matched: false, matchedRecordId: null };

            if (searchKey && portfolioRecords.length > 0) {
                const matchResult = matcher.findMatch(searchKey, portfolioRecords);
                if (matchResult) {
                    matchedData = {
                        matched: true,
                        matchedRecordId: matchResult.record.id,
                        matchedRecordDisplay: matcher.getDisplayLabel(matchResult.record)
                    };
                }
            }

            documents.push({
                ...data,
                id: d.id,
                ...matchedData,
                EVRAK_NO: data.evrakNo,
                DOSYA_NO: data.dosyaNo,
                status: data.status || 'pending'
            });
        });

        return documents;
    } catch (error) {
        console.error("Veritabanı Okuma Hatası:", error);
        return [];
    }
},

async processNotifications(notifications, userId) {
        const processedNotifications = [];

        for (const notification of notifications) {
            // Match with portfolio using dosya_no = applicationNumber
            const matchResult = await this.matchWithPortfolio(notification.DOSYA_NO);
            
            const processedNotification = {
                evrakNo: notification.EVRAK_NO,
                dosyaNo: notification.DOSYA_NO,
                dosyaTuru: notification.DOSYA_TURU,
                uygulamaKonmaTarihi: new Date(notification.UYGULAMAYA_KONMA_TARIHI),
                belgeTarihi: new Date(notification.BELGE_TARIHI),
                belgeAciklamasi: notification.BELGE_ACIKLAMASI,
                ilgiliVekil: notification.ILGILI_VEKIL,
                tebligTarihi: notification.TEBLIG_TARIHI ? new Date(notification.TEBLIG_TARIHI) : null,
                tebellugeden: notification.TEBELLUGEDEN,
                
                // Matching information
                matched: matchResult.matched,
                matchedRecord: matchResult.matched ? matchResult.record : null,
                matchConfidence: matchResult.confidence || 0,
                
                // Processing status
                processStatus: 'pending',
                processedAt: new Date(),
                userId: userId
            };

            processedNotifications.push(processedNotification);
        }
        console.log("✅ İşlenmiş tebligatlar sayısı:", processedNotifications.length);
        console.log("🔄 Matched örneği:", processedNotifications.find(n => n.matched));
        console.log("⚠️ Unmatched örneği:", processedNotifications.find(n => !n.matched));

        return processedNotifications;
    },

    // Match notification with portfolio records
    async matchWithPortfolio(dosyaNo) {
        try {
            // Get all IP records for matching
            const recordsResult = await ipRecordsService.getRecords();
            
            if (!recordsResult.success) {
                console.error('Portfolio records fetch error:', recordsResult.error);
                return { matched: false, confidence: 0 };
            }

            const records = recordsResult.data;

            // Direct match: dosya_no = applicationNumber
            const directMatch = records.find(record => 
                record.applicationNumber === dosyaNo
            );

            if (directMatch) {
                return {
                    matched: true,
                    record: directMatch,
                    confidence: 100,
                    matchType: 'applicationNumber'
                };
            }

            // Secondary matching attempts
            // Try with different formats (remove slashes, spaces, etc.)
            const cleanDosyaNo = dosyaNo.replace(/[\/\s-]/g, '');
            
            const secondaryMatch = records.find(record => {
                const cleanAppNumber = record.applicationNumber?.replace(/[\/\s-]/g, '') || '';
                return cleanAppNumber === cleanDosyaNo;
            });

            if (secondaryMatch) {
                return {
                    matched: true,
                    record: secondaryMatch,
                    confidence: 85,
                    matchType: 'applicationNumber_normalized'
                };
            }

            // No match found
            return { 
                matched: false, 
                confidence: 0,
                searchedValue: dosyaNo
            };

        } catch (error) {
            console.error('Portfolio matching error:', error);
            return { matched: false, confidence: 0, error: error.message };
        }
    },

    // Save notifications to Firebase for tracking
    async saveNotificationsToFirebase(notifications, userId, token) {
        try {
            const batch = writeBatch(db);
            const timestamp = new Date();

            for (const notification of notifications) {
                const docRef = doc(collection(db, 'etebs_notifications'));
                batch.set(docRef, {
                    ...notification,
                    tokenUsed: token.substring(0, 8) + '...',  // Don't save full token
                    fetchedAt: timestamp
                });
            }

            await batch.commit();
            
            // Update token usage log
            await this.updateTokenUsage(userId, token, notifications.length);

        } catch (error) {
            console.error('Failed to save notifications to Firebase:', error);
        }
    },

    // Token management
    async saveToken(token, userId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };

        try {
            const tokenData = {
                token: token,
                userId: userId,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
                isActive: true,
                usageCount: 0
            };

            await setDoc(doc(db, 'etebs_tokens', userId), tokenData);
            
            return { success: true, data: tokenData };

        } catch (error) {
            console.error('Token save error:', error);
            return { success: false, error: error.message };
        }
    },

    async getToken(userId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };

        try {
            const tokenDoc = await getDoc(doc(db, 'etebs_tokens', userId));
            
            if (tokenDoc.exists()) {
                const tokenData = tokenDoc.data();
                
                // Check if token is still valid
                if (tokenData.expiresAt.toDate() > new Date()) {
                    return { success: true, data: tokenData };
                } else {
                    return { success: false, error: 'Token süresi dolmuş' };
                }
            }
            
            return { success: false, error: 'Token bulunamadı' };

        } catch (error) {
            console.error('Token get error:', error);
            return { success: false, error: error.message };
        }
    },

    async updateTokenUsage(userId, token, notificationCount) {
        try {
            const tokenRef = doc(db, 'etebs_tokens', userId);
            await updateDoc(tokenRef, {
                lastUsedAt: new Date(),
                usageCount: arrayUnion({
                    date: new Date(),
                    notificationCount: notificationCount
                })
            });
        } catch (error) {
            console.error('Token usage update error:', error);
        }
    },

    // Error logging
    async logETEBSError(userId, action, errorMessage, context = {}) {
        try {
            await addDoc(collection(db, 'etebs_logs'), {
                userId: userId,
                action: action,
                status: 'error',
                errorMessage: errorMessage,
                context: context,
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Error logging failed:', error);
        }
    },

    async logTokenError(userId, token, errorMessage) {
        try {
            await addDoc(collection(db, 'etebs_token_errors'), {
                userId: userId,
                tokenPrefix: token.substring(0, 8) + '...',
                errorMessage: errorMessage,
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Token error logging failed:', error);
        }
    },

    // Get user's ETEBS notifications
    async getUserNotifications(userId, filters = {}) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor.", data: [] };

        try {
            let q = query(
                collection(db, 'etebs_notifications'),
                where('userId', '==', userId),
                orderBy('fetchedAt', 'desc')
            );

            // Apply filters
            if (filters.dosyaTuru) {
                q = query(q, where('dosyaTuru', '==', filters.dosyaTuru));
            }

            if (filters.matched !== undefined) {
                q = query(q, where('matched', '==', filters.matched));
            }

            const snapshot = await getDocs(q);
            const notifications = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            return { success: true, data: notifications };

        } catch (error) {
            console.error('Get user notifications error:', error);
            return { success: false, error: error.message, data: [] };
        }
    }
};

// Auto-process matched notifications
export const etebsAutoProcessor = {
    // Automatically process matched notifications
    async autoProcessMatched(notifications, userId) {
        const results = [];

        for (const notification of notifications.filter(n => n.matched)) {
            try {
                // Determine transaction type based on document type and description
                const transactionType = await this.determineTransactionType(notification);
                
                if (transactionType) {
                    // Create automatic indexing entry
                    const indexingResult = await this.createAutoIndexing(notification, transactionType, userId);
                    results.push({
                        notification: notification,
                        success: true,
                        indexingId: indexingResult.id,
                        transactionType: transactionType
                    });
                } else {
                    results.push({
                        notification: notification,
                        success: false,
                        error: 'Transaction type belirlenemedi'
                    });
                }

            } catch (error) {
                console.error(`Auto processing failed for ${notification.evrakNo}:`, error);
                results.push({
                    notification: notification,
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    },

    // Determine transaction type based on document content
    async determineTransactionType(notification) {
        try {
            // Get transaction types
            const transactionTypesResult = await transactionTypeService.getTransactionTypes();
            if (!transactionTypesResult.success) return null;

            const transactionTypes = transactionTypesResult.data;
            const description = notification.belgeAciklamasi.toLowerCase();

            // Mapping rules based on document description
            const mappingRules = {
                'tescil': 'registration',
                'başvuru': 'application',
                'red': 'rejection',
                'itiraz': 'opposition',
                'yenileme': 'renewal',
                'inceleme': 'examination',
                'karar': 'decision',
                'bildirim': 'notification'
            };

            // Find matching transaction type
            for (const [keyword, typeCode] of Object.entries(mappingRules)) {
                if (description.includes(keyword)) {
                    const matchedType = transactionTypes.find(t => 
                        t.code === typeCode || 
                        t.name.toLowerCase().includes(keyword)
                    );
                    
                    if (matchedType) {
                        return matchedType;
                    }
                }
            }

            // Default transaction type if no specific match
            return transactionTypes.find(t => t.isDefault) || transactionTypes[0];

        } catch (error) {
            console.error('Transaction type determination error:', error);
            return null;
        }
    },

    // Create automatic indexing entry
    async createAutoIndexing(notification, transactionType, userId) {
        try {
            const indexingData = {
                ipRecordId: notification.matchedRecord.id,
                transactionTypeId: transactionType.id,
                documentSource: 'etebs',
                etebsEvrakNo: notification.evrakNo,
                etebsDosyaNo: notification.dosyaNo,
                documentDate: notification.belgeTarihi,
                description: notification.belgeAciklamasi,
                autoProcessed: true,
                processedAt: new Date(),
                userId: userId,
                status: 'completed'
            };

            const docRef = await addDoc(collection(db, 'indexed_documents'), indexingData);
            
            return { success: true, id: docRef.id };

        } catch (error) {
            console.error('Auto indexing creation error:', error);
            return { success: false, error: error.message };
        }
    }
};
console.log('🔐 ETEBS Service Layer loaded successfully');

export const searchRecordService = {
    // Belirli bir marka ve bülten için kayıt getirir
    async getRecord(bulletinKey, monitoredTrademarkId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            // ✅ SUBCOLLECTION PATH: collection/document/subcollection/subdocument (4 segment)
            const docRef = doc(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks', monitoredTrademarkId);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) return { success: false, error: "Kayıt bulunamadı" };
            return { success: true, data: docSnap.data() };
        } catch (error) {
            console.error("Arama kaydı getirilirken hata:", error);
            return { success: false, error: error.message };
        }
    },

    // Belirli bir marka ve bülten için kayıt kaydeder
    async saveRecord(bulletinKey, monitoredTrademarkId, data) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            // ✅ SUBCOLLECTION PATH: collection/document/subcollection/subdocument (4 segment)
            const docRef = doc(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks', monitoredTrademarkId);
            await setDoc(docRef, {
                monitoredTrademarkId,
                ...data,
                searchDate: new Date().toISOString()
            });
            return { success: true };
        } catch (error) {
            console.error("Arama kaydı kaydedilirken hata:", error);
            return { success: false, error: error.message };
        }
    },

    // Belirli bir marka ve bülten kaydını siler
    async deleteRecord(bulletinKey, monitoredTrademarkId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            // ✅ SUBCOLLECTION PATH
            const docRef = doc(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks', monitoredTrademarkId);
            await deleteDoc(docRef);
            return { success: true };
        } catch (error) {
            console.error("Arama kaydı silinirken hata:", error);
            return { success: false, error: error.message };
        }
    },

    // Belirli bir bültene ait tüm marka kayıtlarını getirir
    async getAllRecordsForBulletin(bulletinKey) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            // ✅ SUBCOLLECTION REFERENCE
            const trademarkCollectionRef = collection(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks');
            const snapshot = await getDocs(trademarkCollectionRef);
            const records = [];
            snapshot.forEach(docSnap => {
                records.push({ id: docSnap.id, ...docSnap.data() });
            });
            return { success: true, data: records };
        } catch (error) {
            console.error("Bülten kayıtları alınırken hata:", error);
            return { success: false, error: error.message };
        }
    },

    // Belirli bir bültende hangi marka ID'leri var döndürür
    async getBulletinTrademarkIds(bulletinKey) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            // ✅ SUBCOLLECTION REFERENCE
            const trademarkCollectionRef = collection(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks');
            const snapshot = await getDocs(trademarkCollectionRef);
            const ids = [];
            snapshot.forEach(docSnap => ids.push(docSnap.id));
            return { success: true, data: ids };
        } catch (error) {
            console.error("Bülten marka ID'leri alınırken hata:", error);
            return { success: false, error: error.message };
        }
    }
};

// --- Similarity Service ---
export const similarityService = {
    /**
     * Sonuç kaydı için alan günceller (isSimilar, bs, note vb.)
     * @param {string} monitoredTrademarkId - İzlenen marka ID'si
     * @param {string} bulletinKey - Bülten anahtarı (bulletinno_bulletindate formatında)
     * @param {string} resultId - Sonuç ID'si
     * @param {Object} fields - Güncellenecek alanlar ({ isSimilar, bs, note, ... })
     * @returns {Object} Başarı durumu
     */
    async updateSimilarityFields(monitoredTrademarkId, bulletinKey, resultId, fields) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };

        try {
            // ✅ GÜNCEL: searchRecordService.getRecord parametreleri doğru sırada
            const result = await searchRecordService.getRecord(bulletinKey, monitoredTrademarkId);

            if (result.success && result.data) {
                const updatedResults = result.data.results.map(r => {
                    if (r.objectID === resultId || r.applicationNo === resultId) {
                        return { 
                            ...r, 
                            ...fields, // Yeni alanları buraya ekle
                            lastUpdate: new Date().toISOString() // Son güncelleme zamanını ekle
                        };
                    }
                    return r;
                });

                const updateData = { 
                    ...result.data, 
                    results: updatedResults,
                    lastSimilarityUpdate: new Date().toISOString()
                };

                // ✅ GÜNCEL: searchRecordService.saveRecord parametreleri doğru sırada
                await searchRecordService.saveRecord(bulletinKey, monitoredTrademarkId, updateData);

                console.log(`✅ Alanlar güncellendi: ${bulletinKey}/${monitoredTrademarkId}/${resultId}`, fields);
                return { success: true };
            }

            return { success: false, error: 'Arama kaydı bulunamadı' };

        } catch (error) {
            console.error('Alanlar güncellenirken hata:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Belirli bir kaydın benzerlik durumunu alır
     * @param {string} monitoredTrademarkId - İzlenen marka ID'si
     * @param {string} bulletinKey - Bülten anahtarı
     * @param {string} resultId - Sonuç ID'si
     * @returns {Object} Benzerlik durumu bilgisi
     */
    async getSimilarityStatus(monitoredTrademarkId, bulletinKey, resultId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        
        try {
            // ✅ GÜNCEL: parametreler doğru sırada
            const result = await searchRecordService.getRecord(bulletinKey, monitoredTrademarkId);
            
            if (result.success && result.data) {
                const targetResult = result.data.results.find(r => 
                    r.objectID === resultId || r.applicationNo === resultId
                );
                
                if (targetResult) {
                    return { 
                        success: true, 
                        data: {
                            isSimilar: targetResult.isSimilar,
                            bs: targetResult.bs,
                            note: targetResult.note,
                            lastUpdate: targetResult.lastUpdate
                        }
                    };
                }
                
                return { success: false, error: 'Belirtilen sonuç bulunamadı' };
            }
            
            return { success: false, error: 'Arama kaydı bulunamadı' };
            
        } catch (error) {
            console.error('Benzerlik durumu alınırken hata:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Toplu benzerlik durumu günceller
     * @param {string} monitoredTrademarkId - İzlenen marka ID'si
     * @param {string} bulletinKey - Bülten anahtarı
     * @param {Array} updates - Güncellenecek kayıtlar [{ resultId, isSimilar }, ...]
     * @returns {Object} Başarı durumu
     */
    async bulkUpdateSimilarityStatus(monitoredTrademarkId, bulletinKey, updates) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        
        try {
            // ✅ GÜNCEL: parametreler doğru sırada
            const result = await searchRecordService.getRecord(bulletinKey, monitoredTrademarkId);
            
            if (result.success && result.data) {
                const updatedResults = result.data.results.map(r => {
                    const update = updates.find(u => 
                        u.resultId === r.objectID || u.resultId === r.applicationNo
                    );
                    
                    if (update) {
                        return { 
                            ...r, 
                            isSimilar: update.isSimilar, 
                            similarityUpdatedAt: new Date().toISOString() 
                        };
                    }
                    return r;
                });
                
                const updateData = { 
                    ...result.data, 
                    results: updatedResults,
                    lastSimilarityUpdate: new Date().toISOString()
                };
                
                // ✅ GÜNCEL: parametreler doğru sırada
                await searchRecordService.saveRecord(bulletinKey, monitoredTrademarkId, updateData);
                
                console.log(`✅ Toplu benzerlik durumu güncellendi: ${updates.length} kayıt`);
                return { success: true, updatedCount: updates.length };
            }
            
            return { success: false, error: 'Arama kaydı bulunamadı' };
            
        } catch (error) {
            console.error('Toplu benzerlik durumu güncellenirken hata:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Benzerlik istatistiklerini alır
     * @param {string} monitoredTrademarkId - İzlenen marka ID'si
     * @param {string} bulletinKey - Bülten anahtarı (opsiyonel, boşsa tüm bültenler)
     * @returns {Object} İstatistik bilgileri
     */
    async getSimilarityStats(monitoredTrademarkId, bulletinKey = null) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        
        try {
            if (bulletinKey) {
                // Belirli bir bülten için istatistik
                // ✅ GÜNCEL: parametreler doğru sırada
                const result = await searchRecordService.getRecord(bulletinKey, monitoredTrademarkId);
                
                if (result.success && result.data) {
                    const results = result.data.results || [];
                    const similarCount = results.filter(r => r.isSimilar === true).length;
                    const notSimilarCount = results.filter(r => r.isSimilar === false).length;
                    const pendingCount = results.filter(r => r.isSimilar === undefined || r.isSimilar === null).length;
                    
                    return {
                        success: true,
                        data: {
                            total: results.length,
                            similar: similarCount,
                            notSimilar: notSimilarCount,
                            pending: pendingCount
                        }
                    };
                }
                
                return { success: false, error: 'Arama kaydı bulunamadı' };
            } else {
                // Tüm bültenler için istatistik (gelecekte implement edilebilir)
                return { success: false, error: 'Tüm bülten istatistikleri henüz desteklenmiyor' };
            }
            
        } catch (error) {
            console.error('Benzerlik istatistikleri alınırken hata:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Filtrelenmiş sonuçları alır
     * @param {string} monitoredTrademarkId - İzlenen marka ID'si
     * @param {string} bulletinKey - Bülten anahtarı
     * @param {string} filter - Filtre türü ('similar', 'notSimilar', 'pending', 'withNotes', 'all')
     * @returns {Object} Filtrelenmiş sonuçlar
     */
    async getFilteredResults(monitoredTrademarkId, bulletinKey, filter = 'all') {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        
        try {
            // ✅ GÜNCEL: parametreler doğru sırada
            const result = await searchRecordService.getRecord(bulletinKey, monitoredTrademarkId);
            
            if (result.success && result.data && result.data.results) {
                let filteredResults = [];
                
                switch (filter) {
                    case 'similar':
                        filteredResults = result.data.results.filter(r => r.isSimilar === true);
                        break;
                    case 'notSimilar':
                        filteredResults = result.data.results.filter(r => r.isSimilar === false);
                        break;
                    case 'pending':
                        filteredResults = result.data.results.filter(r => r.isSimilar === undefined || r.isSimilar === null);
                        break;
                    case 'withNotes':
                        filteredResults = result.data.results.filter(r => r.note && r.note.trim());
                        break;
                    default:
                        filteredResults = result.data.results;
                }
                
                return { success: true, data: filteredResults };
            }
            
            return { success: false, error: 'Arama kaydı bulunamadı' };
            
        } catch (error) {
            console.error('Filtrelenmiş sonuçlar alınırken hata:', error);
            return { success: false, error: error.message };
        }
    }
};
// --- Exports ---
export {auth, storage, db, functions, app}; 
export const firebaseServices = { 
    auth: auth,
    db: db,
    storage: storage,
    functions: functions,
    storageRef: ref, 
    uploadBytesResumable: uploadBytesResumable, 
    getDownloadURL: getDownloadURL, 
    deleteObject: deleteObject,
 };

 // ------------------------------------------------------
// Genel Auth Helper'ları
// ------------------------------------------------------

let authUserReadyPromise = null;

export function waitForAuthUser(options = {}) {
    const { requireAuth = false, redirectTo = 'index.html', graceMs = 800 } = options;

    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe(); // ilk sonucu al ve bırak

            // Auth varsa direkt çöz
            if (user) {
                resolve(user);
                return;
            }

            // Auth gerekmiyorsa null dön
            if (!requireAuth) {
                resolve(null);
                return;
            }

            // --- GRACE PERIOD: null geldiyse hemen redirect etme ---
            // localStorage'da kullanıcı var gibi görünüyorsa veya çok sekmeli gecikme oluyorsa,
            // kısa süre bekleyip tekrar kontrol et.
            const localUser = localStorage.getItem('currentUser');

            setTimeout(() => {
                const stableUser = auth.currentUser;

                if (stableUser) {
                    resolve(stableUser);
                    return;
                }

                // Hala yoksa o zaman gerçekten oturum yok kabul et
                console.warn("Oturum bulunamadı (stabil), yönlendiriliyor...");
                if (localUser) localStorage.removeItem('currentUser');
                window.location.href = redirectTo;
                resolve(null);
            }, graceMs);
        });
    });
}

export function redirectOnLogout(redirectTo = 'index.html', graceMs = 800) {
    let initialCheckDone = false;

    onAuthStateChanged(auth, (user) => {
        if (!initialCheckDone) {
            initialCheckDone = true;
            return;
        }

        if (user) return;

        // GRACE: bir anlık null için hemen redirect etme
        setTimeout(() => {
            if (auth.currentUser) return;

            console.warn("Oturum sonlandırıldı (stabil), ana sayfaya yönlendiriliyor...");
            localStorage.removeItem('currentUser');
            window.location.href = redirectTo;
        }, graceMs);
    });
}

// Hatırlatıcı Servisi (Eksik olan kısım)
export const reminderService = {
    // Tüm hatırlatıcıları getir
    async getReminders() {
        try {
            const q = query(collection(db, "reminders"), orderBy("dueDate", "asc"));
            const querySnapshot = await getDocs(q);
            const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return { success: true, data };
        } catch (error) {
            console.error("Hatırlatıcılar çekilemedi:", error);
            return { success: false, error: error.message };
        }
    },

    // Yeni hatırlatıcı ekle
    async addReminder(reminderData) {
        try {
            const docRef = await addDoc(collection(db, "reminders"), {
                ...reminderData,
                createdAt: new Date().toISOString()
            });
            return { success: true, id: docRef.id };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Hatırlatıcı güncelle (Okundu yap veya Arşivle)
    async updateReminder(id, updateData) {
        try {
            const docRef = doc(db, "reminders", id);
            await updateDoc(docRef, {
                ...updateData,
                updatedAt: new Date().toISOString()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};