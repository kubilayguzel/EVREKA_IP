import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, addDoc,
    getDocs, doc, updateDoc, deleteDoc,
    query, orderBy, where, getDoc, setDoc, arrayUnion, writeBatch, documentId, serverTimestamp, Timestamp, FieldValue }
from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

// --- Firebase App Initialization ---
const firebaseConfig = {
  apiKey: "AIzaSyDbdqfiVbobnl1BtyiWxhD4bfIcREw8ZRc",
  authDomain: "ip-manager-production-aab4b.firebaseapp.com",
  projectId: "ip-manager-production-aab4b",
  storageBucket: "ip-manager-production-aab4b.firebasestorage.app",
  messagingSenderId: "594650169512",
  appId: "1:594650169512:web:43496005e063a40511829d",
  measurementId: "G-QY1P3ZCMC4"
};

let app, auth, db, storage;
let isFirebaseAvailable = false;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
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
    async getRecords() {
        if (!isFirebaseAvailable) return { success: true, data: [] };
        try {
            const snapshot = await getDocs(query(collection(db, 'ipRecords'), orderBy('createdAt', 'desc')));
            return { success: true, data: snapshot.docs.map(d => ({ id: d.id, ...d.data() })) };
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
            const querySnapshot = await getDocs(q);
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
    
    async addTransactionToRecord(recordId, transactionData) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const recordRef = doc(db, 'ipRecords', recordId);
            const transactionsCollectionRef = collection(recordRef, 'transactions');

            const currentUser = auth.currentUser;
            let userName = 'Bilinmeyen Kullanıcı';

            if (currentUser) {
                userName = currentUser.displayName || currentUser.email;
            }

            const transactionToAdd = {
                ...transactionData,
                timestamp: new Date().toISOString(),
                userId: currentUser ? currentUser.uid : 'anonymous',
                userEmail: currentUser ? currentUser.email : 'anonymous@example.com',
                userName: userName
            };

            const docRef = await addDoc(transactionsCollectionRef, transactionToAdd);
            return { success: true, id: docRef.id, data: transactionToAdd };
        } catch (error) {
            console.error("Transaction alt koleksiyona eklenirken hata:", error);
            return { success: false, error: error.message };
        }
    },
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
    async linkUserToPersons(userId, personIds) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, {
                linkedPersonIds: Array.isArray(personIds) ? personIds : [],
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
            if (!userDoc.exists() || !userDoc.data().linkedPersonIds || !Array.isArray(userDoc.data().linkedPersonIds)) {
                return { success: true, data: [] };
            }
            
            const personIds = userDoc.data().linkedPersonIds;
            if (personIds.length === 0) {
                return { success: true, data: [] };
            }
            
            // Batch olarak kişileri getir
            const personPromises = personIds.map(id => getDoc(doc(db, 'persons', id)));
            const personDocs = await Promise.all(personPromises);
            
            const persons = personDocs
                .filter(doc => doc.exists())
                .map(doc => ({ id: doc.id, ...doc.data() }));
            
            return { success: true, data: persons };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    async unlinkUserFromAllPersons(userId) {
        if (!isFirebaseAvailable) return { success: false, error: "Firebase kullanılamıyor." };
        try {
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, {
                linkedPersonIds: [],
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
            
            const newAccrual = {
                ...accrualData,
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

// ETEBS Error Codes
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
    // Token validation
    validateToken(token) {
        if (!token || typeof token !== 'string') {
            return { valid: false, error: 'Token gerekli' };
        }
        
        // GUID format validation
        const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        
        if (!guidRegex.test(token)) {
            return { valid: false, error: 'Geçersiz token formatı' };
        }
        
        return { valid: true };
    },

    // Get daily notifications from ETEBS
    // Updated getDailyNotifications using Firebase Functions proxy
    getDailyNotifications: async function(token) {
    try {
        const response = await fetch(ETEBS_CONFIG.proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'daily-notifications',
                token: token
            })
        });

        if (!response.ok) {
            console.error("❌ ETEBS API HTTP hatası:", response.status);
            return { success: false, error: `ETEBS API bağlantısı başarısız: ${response.status}` };
        }

        let result;
        try {
            result = await response.json();
        } catch (jsonErr) {
            console.error("🛑 Yanıt JSON'a çevrilemedi:", jsonErr);
            const rawText = await response.text();
            console.error("📄 Ham yanıt:", rawText);
            return { success: false, error: 'ETEBS yanıtı bozuk ya da JSON değil.' };
        }

        console.log("📥 [ETEBŞ] API yanıtı:", result);

        const etebsData = result.data;

        if (!Array.isArray(etebsData)) {
            console.warn("⚠️ Beklenen veri dizisi değil:", etebsData);
            return { success: true, data: [], totalCount: 0, matchedCount: 0, unmatchedCount: 0 };
        }

        const currentUser = authService.getCurrentUser();
        if (!currentUser) {
            return { success: false, error: 'Kullanıcı kimliği doğrulanamadı.' };
        }

        const processedNotifications = await this.processNotifications(etebsData, currentUser.uid);

        const matchedCount = processedNotifications.filter(n => n.matched).length;
        const unmatchedCount = processedNotifications.length - matchedCount;

        return {
            success: true,
            data: processedNotifications,
            totalCount: processedNotifications.length,
            matchedCount,
            unmatchedCount
        };

    } catch (error) {
        console.error("🔥 getDailyNotifications hata:", error);
        return { success: false, error: 'ETEBS servisine bağlanırken beklenmeyen bir hata oluştu.' };
    }
},
async downloadDocument(token, documentNo) {
    if (!isFirebaseAvailable) {
        return { success: false, error: "Firebase kullanılamıyor." };
    }

    const currentUser = authService.getCurrentUser();
    if (!currentUser) {
        return { success: false, error: "Kullanıcı girişi yapılmamış." };
    }

    // Validate inputs
    const tokenValidation = this.validateToken(token);
    if (!tokenValidation.valid) {
        return { success: false, error: tokenValidation.error };
    }

    if (!documentNo) {
        return { success: false, error: 'Evrak numarası gerekli' };
    }

    try {
        console.log('🔥 ETEBS Download Document via Firebase Functions');

        const response = await fetch(ETEBS_CONFIG.proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'download-document',
                token: token,
                documentNo: documentNo
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Proxy error');
        }

        const etebsData = result.data;

        // Handle ETEBS API errors
        if (etebsData.IslemSonucKod && etebsData.IslemSonucKod !== '000') {
            const errorMessage = ETEBS_ERROR_CODES[etebsData.IslemSonucKod] || 'Bilinmeyen hata';
            return { 
                success: false, 
                error: errorMessage,
                errorCode: etebsData.IslemSonucKod
            };
        }

        // Process downloaded documents
        const processedDocuments = await this.processDownloadedDocuments(etebsData.DownloadDocumentResult, documentNo);
        
        // YENİ: PDF Blob'unu oluştur
        let pdfBlob = null;
        if (processedDocuments.length > 0 && processedDocuments[0].base64) {
            try {
                const binaryString = atob(processedDocuments[0].base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                pdfBlob = new Blob([bytes], { type: 'application/pdf' });
                console.log('✅ PDF Blob oluşturuldu:', pdfBlob.size, 'bytes');
            } catch (error) {
                console.error('Error converting base64 to blob:', error);
            }
        }

        // Upload to Firebase Storage and save metadata
        const uploadResults = await this.uploadDocumentsToFirebase(processedDocuments, currentUser.uid, documentNo);

        return { 
            success: true, 
            data: uploadResults,
            documentCount: processedDocuments.length,
            pdfBlob: pdfBlob, // YENİ: PDF'i blob olarak döndür
            pdfData: processedDocuments.length > 0 ? processedDocuments[0].base64 : null // Eski uyumluluk için base64 data
        };

    } catch (error) {
        console.error('ETEBS Download Document Error:', error);
        
        // Log error to Firebase
        await this.logETEBSError(currentUser.uid, 'downloadDocument', error.message, { documentNo });
        
        // User-friendly error messages
        let userError = 'Evrak indirme hatası';
        
        if (error.name === 'AbortError') {
            userError = 'İndirme zaman aşımına uğradı';
        } else if (error.message.includes('Failed to fetch')) {
            userError = 'Ağ bağlantısı hatası';
        }
        
        return { 
            success: false, 
            error: userError
        };
    }
},



    // Process notifications and match with portfolio
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

    // Convert base64 to file object
    base64ToFile(base64String, fileName) {
    try {
        if (typeof base64String !== 'string') {
        throw new Error('Geçersiz BASE64 veri türü');
        }

        // Varsa data URL önekini temizle
        const base64Data = base64String.replace(/^data:[^;]+;base64,/, '');
        if (!base64Data) {
        throw new Error('BASE64 boş');
        }

        // Base64 -> binary
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
        }

        // Blob + File oluştur
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const safeName = fileName && String(fileName).trim() ? fileName : 'document.pdf';
        const file = new File([blob], safeName, { type: 'application/pdf' });

        return { success: true, file };
    } catch (error) {
        console.error('Base64 to file conversion error:', error);
        return { success: false, error: error.message };
    }
    },

    // Process downloaded documents
    async processDownloadedDocuments(downloadResult, evrakNo) {
  const processedDocs = [];

  if (!Array.isArray(downloadResult)) {
    console.warn('processDownloadedDocuments: downloadResult is not an array:', downloadResult);
    return processedDocs;
  }

  for (const doc of downloadResult) {
    try {
      // EVRAK_NO veya parametre ile gelen evrakNo
      const evrak = (doc && (doc.EVRAK_NO ?? evrakNo)) ? String(doc.EVRAK_NO ?? evrakNo) : 'EVRAK';

      // Açıklama alanı undefined gelebilir → güvenli varsayılan
      const rawDesc = (doc && doc.BELGE_ACIKLAMASI != null) ? String(doc.BELGE_ACIKLAMASI) : 'Belge';

      // Dosya adı için normalize + güvenli karakter seti
      const normalized = rawDesc
        .normalize('NFKD')                  // aksanları ayır
        .replace(/[\u0300-\u036f]/g, '');   // aksan işaretlerini temizle

      const safeDesc = normalized
        .replace(/[^a-zA-Z0-9_-]+/g, '_')   // güvenli olmayanları alt çizgiye çevir
        .replace(/^_+|_+$/g, '')            // baş/sondaki alt çizgileri kaldır
        .slice(0, 80) || 'Belge';           // çok uzunsa kısalt

      const fileName = `${evrak}_${safeDesc}.pdf`;

      // BASE64 boş/yanlış olabilir → kontrol et
      const base64 = doc && doc.BASE64;
      if (!base64 || typeof base64 !== 'string' || !base64.trim()) {
        console.warn(`processDownloadedDocuments: Missing/invalid BASE64 for evrak ${evrak}`);
        continue;
      }

      // DÖNÜŞ: base64ToFile senkron, await kullanmıyoruz
      const fileResult = this.base64ToFile(base64, fileName);
      if (fileResult && fileResult.success) {
        processedDocs.push({
          evrakNo: doc.EVRAK_NO ?? evrakNo ?? null,
          belgeAciklamasi: rawDesc,
          fileName,
          file: fileResult.file,
          base64
        });
      } else {
        console.error(`File conversion failed for ${evrak}:`, fileResult && fileResult.error);
      }
    } catch (err) {
      console.error('processDownloadedDocuments: error while preparing document:', err, doc);
    }
  }

  return processedDocs;
},

    // Upload documents to Firebase Storage
async uploadDocumentsToFirebase(documents, userId, evrakNo) {
    console.log('📤 uploadDocumentsToFirebase başladı:', documents.length, 'dosya');
    const uploadResults = [];

    for (const doc of documents) {
        try {
            console.log('📁 Upload ediliyor:', doc.fileName, 'Evrak:', doc.evrakNo);

            // 1. Firebase Storage'a yükle
            const storagePath = `etebs_documents/${userId}/${doc.evrakNo || evrakNo}/${doc.fileName}`;
            console.log('📂 Storage path:', storagePath);
            
            const storageRef = ref(storage, storagePath);
            
            // doc.file zaten Blob olmalı (base64ToFile'dan geliyor)
            if (!doc.file) {
                throw new Error('File objesi bulunamadı');
            }

            console.log('⬆️ Storage\'a yükleniyor...');
            await uploadBytes(storageRef, doc.file);
            
            console.log('🔗 Download URL alınıyor...');
            const downloadURL = await getDownloadURL(storageRef);
            console.log('✅ Download URL:', downloadURL);

            // 2. Firestore metadata hazırla
            const docData = {
                evrakNo: doc.evrakNo || evrakNo,
                belgeAciklamasi: doc.belgeAciklamasi || 'ETEBS Belgesi',
                fileName: doc.fileName,
                fileUrl: downloadURL,
                filePath: storagePath,
                fileSize: doc.file.size,
                uploadedAt: serverTimestamp(),
                userId: userId,
                source: 'etebs',
                status: 'pending', // İndeksleme için
                extractedAppNumber: doc.evrakNo || evrakNo,
                matchedRecordId: null,
                matchedRecordDisplay: null
            };

            console.log('🔍 Portfolio eşleştirmesi yapılıyor...');
            // 3. Portfolio eşleştirmesi yap
            try {
                const matchResult = await this.matchWithPortfolio(doc.evrakNo || evrakNo);
                if (matchResult.matched) {
                    docData.matchedRecordId = matchResult.record.id;
                    docData.matchedRecordDisplay = `${matchResult.record.title} - ${matchResult.record.applicationNumber}`;
                    console.log('✅ ETEBS Eşleştirme başarılı:', doc.fileName, '→', docData.matchedRecordDisplay);
                } else {
                    console.log('❌ ETEBS Eşleştirme başarısız:', doc.fileName, 'Evrak No:', doc.evrakNo);
                }
            } catch (matchError) {
                console.error('Eşleştirme hatası:', matchError);
            }

            // 4. Firestore'a kaydet - HEM etebs_documents HEM DE unindexed_pdfs'e
            console.log('💾 Firestore\'a kaydediliyor...');
            
            // etebs_documents koleksiyonuna kaydet
            const etebsDocRef = await addDoc(collection(db, 'etebs_documents'), docData);
            console.log('✅ etebs_documents\'a kaydedildi:', etebsDocRef.id);

            // unindexed_pdfs koleksiyonuna da kaydet (indeksleme için)
            const unindexedDocRef = await addDoc(collection(db, 'unindexed_pdfs'), docData);
            console.log('✅ unindexed_pdfs\'e kaydedildi:', unindexedDocRef.id);

            uploadResults.push({
                ...docData,
                id: etebsDocRef.id,
                unindexedPdfId: unindexedDocRef.id, // İndeksleme sayfası için
                success: true
            });

            console.log('✅ Upload tamamlandı:', doc.fileName);

        } catch (error) {
            console.error(`❌ Upload failed for ${doc.fileName}:`, error);
            uploadResults.push({
                fileName: doc.fileName,
                evrakNo: doc.evrakNo || evrakNo,
                success: false,
                error: error.message
            });
        }
    }

    console.log('📤 uploadDocumentsToFirebase tamamlandı. Sonuçlar:', uploadResults);
    return uploadResults;
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