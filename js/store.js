/**
 * TuitionStore - IndexedDB storage engine for Tuition Payment Web App
 * Persists student details, tuition amounts, payment status, and uploaded PNG slips.
 */

class TuitionStore {
    constructor() {
        this.dbName = 'TuitionPaymentDB';
        this.dbVersion = 1;
        this.db = null;
    }

    /**
     * Initialize the IndexedDB database and seed data if empty
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Store for student profiles
                if (!db.objectStoreNames.contains('students')) {
                    db.createObjectStore('students', { keyPath: 'id' });
                }
                
                // Store for payments and slip files (stored as Base64/Blobs)
                if (!db.objectStoreNames.contains('payments')) {
                    const paymentStore = db.createObjectStore('payments', { keyPath: 'id', autoIncrement: true });
                    paymentStore.createIndex('studentId', 'studentId', { unique: false });
                    paymentStore.createIndex('status', 'status', { unique: false });
                }
            };

            request.onsuccess = async (event) => {
                this.db = event.target.result;
                try {
                    await this.seedDataIfEmpty();
                    resolve(true);
                } catch (err) {
                    console.error("Failed to seed database", err);
                    resolve(true); // Still resolve so the app loads
                }
            };

            request.onerror = (event) => {
                console.error("IndexedDB initialization error:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Get a transaction for a specific store
     */
    getTransaction(storeName, mode = 'readonly') {
        if (!this.db) throw new Error("Database not initialized");
        const transaction = this.db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        return { transaction, store };
    }

    // --- STUDENT OPERATIONS ---

    async getStudents() {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('students', 'readonly');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getStudentById(id) {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('students', 'readonly');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async addStudent(student) {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('students', 'readwrite');
            const request = store.add(student);
            request.onsuccess = () => resolve(student);
            request.onerror = () => reject(request.error);
        });
    }

    async updateStudent(student) {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('students', 'readwrite');
            const request = store.put(student);
            request.onsuccess = () => resolve(student);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteStudent(id) {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('students', 'readwrite');
            const request = store.delete(id);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // --- PAYMENT OPERATIONS ---

    async getPayments() {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('payments', 'readonly');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getPaymentsByStudentId(studentId) {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('payments', 'readonly');
            const index = store.index('studentId');
            const request = index.getAll(IDBKeyRange.only(studentId));
            request.onsuccess = () => {
                // Sort payments by date descending
                const sorted = (request.result || []).sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
                resolve(sorted);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async addPayment(payment) {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('payments', 'readwrite');
            const request = store.add(payment);
            request.onsuccess = (event) => {
                payment.id = event.target.result;
                resolve(payment);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updatePayment(payment) {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('payments', 'readwrite');
            const request = store.put(payment);
            request.onsuccess = () => resolve(payment);
            request.onerror = () => reject(request.error);
        });
    }

    async getPaymentById(id) {
        return new Promise((resolve, reject) => {
            const { store } = this.getTransaction('payments', 'readonly');
            const request = store.get(Number(id));
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    // --- SEED MOCK DATA ---

    async seedDataIfEmpty() {
        if (localStorage.getItem('tuition_seeded') === 'true') return;
        const students = await this.getStudents();
        if (students.length > 0) {
            localStorage.setItem('tuition_seeded', 'true');
            return; // Database already seeded
        }

        console.log("Database empty. Seeding tuition payment mock data...");

        // 1. Create Mock Student list
        const mockStudents = [
            { id: "STD001", name: "สมชาย ใจดี", room: "1", year: "1", totalTuition: 60000, paidAmount: 60000, status: "paid" },
            { id: "STD002", name: "สมหญิง รักเรียน", room: "2", year: "1", totalTuition: 60000, paidAmount: 20000, status: "installment" },
            { id: "STD003", name: "เกรียงไกร มุ่งมั่น", room: "1", year: "2", totalTuition: 60000, paidAmount: 0, status: "pending" },
            { id: "STD004", name: "พลอยใส รักดี", room: "3", year: "1", totalTuition: 60000, paidAmount: 0, status: "rejected" },
            { id: "STD005", name: "อนันต์ ยอดเยี่ยม", room: "2", year: "2", totalTuition: 60000, paidAmount: 0, status: "unpaid" }
        ];

        for (const student of mockStudents) {
            await this.addStudent(student);
        }

        // Generate beautiful base64 mock slips to populate database
        const mockSlips = {
            approved: this.generateMockSlipBase64("STD001", "สมชาย ใจดี", 60000, "15/05/2026 10:30"),
            installment: this.generateMockSlipBase64("STD002", "สมหญิง รักเรียน", 20000, "12/05/2026 14:15"),
            pending: this.generateMockSlipBase64("STD003", "เกรียงไกร มุ่งมั่น", 20000, "16/05/2026 09:45"),
            rejected: this.generateMockSlipBase64("STD004", "พลอยใส รักดี", 10000, "08/05/2026 16:20")
        };

        // 2. Create Mock Payments history
        const mockPayments = [
            // STD001: Paid in Full, Approved
            {
                studentId: "STD001",
                amount: 60000,
                dateTime: "2026-05-15T10:30:00",
                slipImage: mockSlips.approved,
                slipName: "slip_STD001_1715769000.png",
                status: "approved",
                refNo: "SCB2026051590812",
                verificationDate: "2026-05-15T11:00:00",
                comment: "ยอดชำระเต็มจำนวน ได้รับเอกสารครบถ้วน"
            },
            // STD002: Installment 1, Approved
            {
                studentId: "STD002",
                amount: 20000,
                dateTime: "2026-05-12T14:15:00",
                slipImage: mockSlips.installment,
                slipName: "slip_STD002_1715523300.png",
                status: "approved",
                refNo: "KBK2026051241103",
                verificationDate: "2026-05-12T15:30:00",
                comment: "ชำระงวดที่ 1/3 ผ่านธนาคารกสิกรไทย"
            },
            // STD003: Installment 1, Pending Verification
            {
                studentId: "STD003",
                amount: 20000,
                dateTime: "2026-05-16T09:45:00",
                slipImage: mockSlips.pending,
                slipName: "slip_STD003_1715852700.png",
                status: "pending",
                refNo: "BAY2026051670982",
                verificationDate: "",
                comment: ""
            },
            // STD004: Payment Rejected
            {
                studentId: "STD004",
                amount: 10000,
                dateTime: "2026-05-08T16:20:00",
                slipImage: mockSlips.rejected,
                slipName: "slip_STD004_1715181600.png",
                status: "rejected",
                refNo: "BBL2026050853489",
                verificationDate: "2026-05-09T09:00:00",
                comment: "จำนวนเงินในสลิปไม่ถูกต้อง (ระบุชำระ 20,000 แต่ยอดโอนจริงคือ 10,000) กรุณาทำรายการใหม่"
            }
        ];

        for (const payment of mockPayments) {
            await this.addPayment(payment);
        }

        console.log("Tuition Database Seeded successfully with mock PNG slips!");
        localStorage.setItem('tuition_seeded', 'true');
    }

    /**
     * Utility method to generate a premium-looking base64 E-Slip image
     * rendered programmatically on a Canvas! This eliminates placeholder files and
     * creates an extremely authentic, beautiful demonstration!
     */
    generateMockSlipBase64(stdId, stdName, amount, dateStr, phoneStr) {
        const canvas = document.createElement('canvas');
        canvas.width = 460;
        canvas.height = 620;
        const ctx = canvas.getContext('2d');

        // Defaults
        const nameVal = stdName || 'วิริวัลย์ เปสุยะ รุ่น21';
        const idVal = stdId || 'รหัส0338';
        const phoneVal = phoneStr || '0811322816';
        const amountVal = amount ? parseFloat(amount) : 2500;
        const dateVal = dateStr || '22 มี.ค. 69 10:31 น.';

        // 1. Background (Light Blue-Green Gradient matching Kasikornbank K+ Slip)
        const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        bgGrad.addColorStop(0, '#e5f6f7');
        bgGrad.addColorStop(0.3, '#f2fafb');
        bgGrad.addColorStop(1, '#ffffff');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Draw Decorative Money Float Shapes on Background
        ctx.fillStyle = 'rgba(16, 185, 129, 0.04)';
        // Rect 1
        ctx.save();
        ctx.translate(350, 60);
        ctx.rotate(Math.PI / 8);
        ctx.fillRect(0, 0, 40, 24);
        ctx.restore();
        // Rect 2
        ctx.save();
        ctx.translate(410, 100);
        ctx.rotate(-Math.PI / 12);
        ctx.fillRect(0, 0, 36, 20);
        ctx.restore();

        // 3. Header Section
        ctx.textAlign = 'left';
        // "โอนเงินสำเร็จ" Green Accent Bar
        ctx.fillStyle = '#11b880';
        ctx.fillRect(15, 20, 5, 45);

        ctx.fillStyle = '#1d1d1f';
        ctx.font = 'bold 20px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('โอนเงินสำเร็จ', 28, 40);

        ctx.fillStyle = '#6e6e73';
        ctx.font = '12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText(dateVal, 28, 60);

        // K+ Logo (Top Right)
        ctx.textAlign = 'right';
        ctx.fillStyle = '#1d1d1f';
        ctx.font = 'bold 28px Arial, sans-serif';
        ctx.fillText('K', 410, 50);
        ctx.fillStyle = '#11b880';
        ctx.font = 'bold 24px Arial, sans-serif';
        ctx.fillText('+', 425, 48);
        ctx.textAlign = 'left'; // Reset

        // Divider
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(15, 80);
        ctx.lineTo(canvas.width - 15, 80);
        ctx.stroke();

        // 4. FROM SECTION (Kasikornbank Circle Logo)
        // Red Outer Circle for Kbank Logo
        ctx.fillStyle = '#e53e3e';
        ctx.beginPath();
        ctx.arc(45, 130, 22, 0, Math.PI * 2);
        ctx.fill();

        // Stylized Rice sheaf logo inside circle (KBank icon representation)
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(40, 120);
        ctx.lineTo(40, 140);
        ctx.moveTo(45, 118);
        ctx.lineTo(45, 142);
        ctx.moveTo(50, 120);
        ctx.lineTo(50, 140);
        ctx.stroke();

        // From text
        ctx.fillStyle = '#1d1d1f';
        ctx.font = 'bold 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText(nameVal, 80, 120);
        
        ctx.font = '12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillStyle = '#4a5568';
        ctx.fillText(`ธ.กสิกรไทย   ${phoneVal ? 'รหัส ' + idVal : idVal}`, 80, 138);
        
        ctx.fillStyle = '#718096';
        ctx.font = '11px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText(phoneVal ? `เบอร์มือถือ: ${phoneVal}` : 'xxx-x-x2215-x', 80, 154);

        // 5. CONNECTING ARROW
        ctx.strokeStyle = '#a0aec0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(45, 162);
        ctx.lineTo(45, 182);
        ctx.moveTo(41, 176);
        ctx.lineTo(45, 182);
        ctx.lineTo(49, 176);
        ctx.stroke();

        // 6. TO SECTION (Krungthai Bank Blue Logo)
        ctx.fillStyle = '#00a2e5';
        ctx.beginPath();
        ctx.arc(45, 215, 22, 0, Math.PI * 2);
        ctx.fill();

        // Bird symbol inside circle (KTB representation)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(45, 215, 8, 0, Math.PI * 2);
        ctx.fill();

        // To text
        ctx.fillStyle = '#1d1d1f';
        ctx.font = 'bold 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('วิทยาลัยเทคโนโลยียานยนต์', 80, 206);
        
        ctx.font = '12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillStyle = '#4a5568';
        ctx.fillText('ธ.กรุงไทย', 80, 224);
        
        ctx.fillStyle = '#718096';
        ctx.font = '11px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('xxx-x-x3605-x', 80, 240);

        // Divider
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.beginPath();
        ctx.moveTo(15, 260);
        ctx.lineTo(canvas.width - 15, 260);
        ctx.stroke();

        // 7. TRANSACTION DETAILS GRID (Left Column details, Right Column QR/Barcode)
        // Draw Left Details
        ctx.fillStyle = '#718096';
        ctx.font = '12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('เลขที่รายการ:', 30, 290);
        
        ctx.fillStyle = '#2d3748';
        ctx.font = 'bold 13px Arial, sans-serif';
        ctx.fillText(`01${idVal.replace(/\D/g,'') || '081'}${Math.floor(Math.random()*10000)}COR${Math.floor(Math.random()*100000)}`, 30, 310);

        ctx.fillStyle = '#718096';
        ctx.font = '12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('จำนวนเงิน:', 30, 345);
        
        ctx.fillStyle = '#1d1d1f';
        ctx.font = 'bold 16px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText(`${amountVal.toLocaleString('th-TH', {minimumFractionDigits: 2})} บาท`, 30, 368);

        ctx.fillStyle = '#718096';
        ctx.font = '12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('ค่าธรรมเนียม:', 30, 405);
        
        ctx.fillStyle = '#2d3748';
        ctx.font = '12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('0.00 บาท', 30, 425);

        // Draw Right Barcode/QR Mockup (matching user screenshot)
        const qrX = 290;
        const qrY = 280;
        const qrSize = 120;

        // QR Box border
        ctx.strokeStyle = '#cbd5e0';
        ctx.lineWidth = 1;
        ctx.strokeRect(qrX, qrY, qrSize, qrSize);

        // QR Corners (Programmatic representation)
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(qrX + 8, qrY + 8, 28, 28);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX + 14, qrY + 14, 16, 16);
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(qrX + 18, qrY + 18, 8, 8);

        ctx.fillStyle = '#1a202c';
        ctx.fillRect(qrX + qrSize - 36, qrY + 8, 28, 28);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX + qrSize - 30, qrY + 14, 16, 16);
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(qrX + qrSize - 26, qrY + 18, 8, 8);

        ctx.fillStyle = '#1a202c';
        ctx.fillRect(qrX + 8, qrY + qrSize - 36, 28, 28);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX + 14, qrY + qrSize - 30, 16, 16);
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(qrX + 18, qrY + qrSize - 26, 8, 8);

        // Mock QR Noise (Small Squares)
        ctx.fillStyle = '#2d3748';
        for (let i = 0; i < 18; i++) {
            const rx = qrX + 38 + Math.floor(Math.random() * 40);
            const ry = qrY + 8 + Math.floor(Math.random() * 100);
            ctx.fillRect(rx, ry, 6, 6);
        }
        for (let i = 0; i < 10; i++) {
            const rx = qrX + 8 + Math.floor(Math.random() * 100);
            const ry = qrY + 38 + Math.floor(Math.random() * 40);
            ctx.fillRect(rx, ry, 6, 6);
        }

        // Label under QR Code
        ctx.fillStyle = '#718096';
        ctx.font = '10px "Noto Sans Thai", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('สแกนตรวจสอบสลิป', qrX + qrSize / 2, qrY + qrSize + 16);
        ctx.textAlign = 'left'; // Reset

        // Divider
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.beginPath();
        ctx.moveTo(15, 460);
        ctx.lineTo(canvas.width - 15, 460);
        ctx.stroke();

        // 8. Bottom Note Section
        ctx.fillStyle = '#4a5568';
        ctx.font = 'bold 12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText(`บันทึกช่วยจำ: ${nameVal} ${idVal}`, 30, 490);

        // Green Safe Stamp Banner
        ctx.fillStyle = '#f0fdf4';
        ctx.fillRect(0, 530, canvas.width, 90);
        
        ctx.fillStyle = '#15803d';
        ctx.font = 'bold 11px "Noto Sans Thai", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('หลักฐานการโอนเงินสำเร็จด้วยแอป K PLUS ของผู้โอน', canvas.width / 2, 560);
        ctx.font = '10px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillStyle = '#16a34a';
        ctx.fillText('ข้อมูลการโอนเงินส่งไปยังสถาบันวิทยาลัยเทคโนโลยียานยนต์สำเร็จ', canvas.width / 2, 580);

        // Security side thin lines
        ctx.strokeStyle = '#11b880';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, canvas.height);
        ctx.moveTo(canvas.width, 0);
        ctx.lineTo(canvas.width, canvas.height);
        ctx.stroke();

        return canvas.toDataURL('image/png');
    }
}

// Global instance
window.tuitionStore = new TuitionStore();
