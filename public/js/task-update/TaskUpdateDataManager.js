// public/js/task-update/TaskUpdateDataManager.js

import { taskService, ipRecordsService, personService, accrualService, transactionTypeService, storage, db } from '../../firebase-config.js';
import { ref, uploadBytes, deleteObject, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export class TaskUpdateDataManager {
    
    // --- GENEL VERİ ÇEKME ---
    async loadAllInitialData() {
        const [ipRecords, persons, users, transactionTypes] = await Promise.all([
            ipRecordsService.getRecords(),
            personService.getPersons(),
            taskService.getAllUsers(),
            transactionTypeService.getTransactionTypes()
        ]);
        
        return {
            ipRecords: ipRecords.data || [],
            persons: persons.data || [],
            users: users.data || [],
            transactionTypes: transactionTypes.data || []
        };
    }

    // --- TASK İŞLEMLERİ ---
    async getTaskById(taskId) {
        const result = await taskService.getTaskById(taskId);
        if (!result.success) throw new Error(result.error);
        return result.data;
    }

    async updateTask(taskId, data) {
        return await taskService.updateTask(taskId, data);
    }

    // --- TAHAKKUK İŞLEMLERİ ---
    async getAccrualsByTaskId(taskId) {
        const result = await accrualService.getAccrualsByTaskId(taskId);
        return result.success ? result.data : [];
    }
    
    async saveAccrual(data, isUpdate = false) {
        if (isUpdate) {
            return await accrualService.updateAccrual(data.id, data);
        } else {
            return await accrualService.addAccrual(data);
        }
    }

    // --- DOSYA İŞLEMLERİ ---
    async uploadFile(file, path) {
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        return await getDownloadURL(storageRef);
    }

    async deleteFileFromStorage(path) {
        if (!path) return; // Path yoksa işlem yapma
        
        // URL encoded karakterleri çöz (Örn: %20 -> Boşluk)
        // Firebase bazen encoded path'i bulamayabilir
        const decodedPath = decodeURIComponent(path);
        
        const storageRef = ref(storage, decodedPath);
        
        try {
            await deleteObject(storageRef);
            console.log('Dosya Storage\'dan silindi:', decodedPath);
        } catch (error) {
            // Eğer dosya zaten yoksa (object-not-found), bunu bir hata olarak görme
            // ve işleme devam et (böylece veritabanından da silinebilsin).
            if (error.code === 'storage/object-not-found') {
                console.warn('Dosya Storage\'da bulunamadı (zaten silinmiş olabilir), veritabanı temizleniyor...', decodedPath);
                return; // Başarılı say
            }
            
            // Başka bir hataysa (yetki vs.) fırlat
            console.error('Dosya silme hatası:', error);
            throw error;
        }
    }

    // --- ARAMA İŞLEMLERİ ---
    searchIpRecords(allRecords, query) {
        if (!query || query.length < 3) return [];
        const lower = query.toLowerCase();
        return allRecords.filter(r => 
            (r.title || '').toLowerCase().includes(lower) || 
            (r.applicationNumber || '').toLowerCase().includes(lower)
        );
    }

    searchPersons(allPersons, query) {
        if (!query || query.length < 2) return [];
        const lower = query.toLowerCase();
        return allPersons.filter(p => 
            (p.name || '').toLowerCase().includes(lower) || 
            (p.email || '').toLowerCase().includes(lower)
        );
    }

    // --- IP RECORD GÜNCELLEME (BAŞVURU NO VS.) ---
    async updateIpRecord(recordId, data) {
        return await ipRecordsService.updateRecord(recordId, data);
    }

    // --- BÜLTEN DETAY ÇEKME ---
    async fetchBulletinData(bulletinId) {
        // Bu metodunuz TaskDataManager'da vardı, buraya taşıyoruz
        // Eğer backend veya ayrı bir servis kullanıyorsanız oradan çağrılmalı
        // Şimdilik placeholder
        console.warn('Bulletin data fetch not implemented completely');
        return null;
    }
    // --- TRANSACTION GÜNCELLEME ---
    async updateTransaction(recordId, transactionId, data) {
        const txRef = doc(db, 'ipRecords', recordId, 'transactions', transactionId);
        return await updateDoc(txRef, data);
    }
}