/**
 * TuitionStore - Supabase Storage engine for Tuition Payment Web App
 * Persists student details, tuition amounts, payment status, and uploaded PNG slips to the cloud.
 */

const SUPABASE_URL = 'https://pshkcdjluvgtuawqumio.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzaGtjZGpsdXZndHVhd3F1bWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDk4OTYsImV4cCI6MjA5NTMyNTg5Nn0.xOizPzboTNtAEYYfdoR1qhMV58USapPUxgcKjMo4Naw';

class TuitionStore {
    constructor() {
        // Initialize Supabase client
        this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // In-memory cache to prevent redundant network calls
        this._cache = {};
        this._cacheTTL = 30000; // 30 seconds
    }

    // --- CACHE HELPERS ---
    _getCached(key) {
        const entry = this._cache[key];
        if (entry && (Date.now() - entry.ts < this._cacheTTL)) {
            return entry.data;
        }
        return null;
    }

    _setCache(key, data) {
        this._cache[key] = { data, ts: Date.now() };
    }

    /** Invalidate specific cache key or all caches */
    invalidateCache(key) {
        if (key) {
            delete this._cache[key];
        } else {
            this._cache = {};
        }
    }

    /**
     * Initialize the database and seed data if empty
     */
    async init() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('seed') === 'true') {
                console.log("Seed parameter detected. Seeding mock data...");
                await this.seedDataIfEmpty();
                // Clean up the URL parameter without refreshing the page
                const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                window.history.pushState({ path: newUrl }, '', newUrl);
            }
            return true;
        } catch (err) {
            console.error("Failed to initialize or seed Supabase database", err);
            return true; // Still resolve so the app loads (it will show empty states if tables missing)
        }
    }

    // --- STUDENT OPERATIONS ---

    async getStudents() {
        const cached = this._getCached('students');
        if (cached) {
            // Apply local avatar overrides
            cached.forEach(student => {
                const localAvatar = localStorage.getItem(`tuition_avatar_${student.id}`);
                if (localAvatar) {
                    student.avatar = localAvatar;
                }
            });
            return cached;
        }

        const { data, error } = await this.supabase
            .from('students')
            .select('*');
        if (error) throw error;
        const result = data || [];

        // Sort logically: If created_at exists, sort by creation time (oldest first, new students at bottom).
        // If created_at is missing, fallback to Mock (STD) first, then numeric ID.
        result.sort((a, b) => {
            const isStdA = a.id && a.id.startsWith('STD');
            const isStdB = b.id && b.id.startsWith('STD');
            
            // Mock data always stays at the top
            if (isStdA && !isStdB) return -1;
            if (!isStdA && isStdB) return 1;

            // If we have created_at, use it to ensure new additions go to the bottom
            if (a.created_at || b.created_at) {
                const tA = a.created_at ? new Date(a.created_at).getTime() : Date.now();
                const tB = b.created_at ? new Date(b.created_at).getTime() : Date.now();
                if (tA !== tB) return tA - tB;
            }
            
            // Fallback: If both are numeric (or neither are STD)
            if (!isStdA && !isStdB) {
                // Try parsing as integers for numeric sorting
                const numA = parseInt(a.id, 10);
                const numB = parseInt(b.id, 10);
                
                if (!isNaN(numA) && !isNaN(numB)) {
                    return numA - numB;
                }
            }
            
            // Absolute fallback to alphabetical sorting
            return (a.id || '').localeCompare(b.id || '');
        });
        
        // Apply local avatar overrides
        result.forEach(student => {
            const localAvatar = localStorage.getItem(`tuition_avatar_${student.id}`);
            if (localAvatar) {
                student.avatar = localAvatar;
            }
        });

        this._setCache('students', result);
        return result;
    }

    async getStudentById(id) {
        // Optimistically check cache first for instant load
        const cachedStudents = this._getCached('students');
        if (cachedStudents) {
            const found = cachedStudents.find(s => s.id === id);
            if (found) {
                const localAvatar = localStorage.getItem(`tuition_avatar_${id}`);
                if (localAvatar) found.avatar = localAvatar;
                return found;
            } else {
                return null;
            }
        }

        const { data, error } = await this.supabase
            .from('students')
            .select('*')
            .eq('id', id)
            .single();
        
        // Supabase returns an error for single() if 0 rows are found, which is annoying. Let's catch it.
        if (error && error.code === 'PGRST116') return null; 
        if (error) throw error;

        if (data) {
            const localAvatar = localStorage.getItem(`tuition_avatar_${id}`);
            if (localAvatar) {
                data.avatar = localAvatar;
            }
        }
        return data;
    }

    async addStudent(student) {
        const insertData = { ...student };
        delete insertData.generation;
        delete insertData.theme; // Theme is stored locally

        const { data, error } = await this.supabase
            .from('students')
            .insert([insertData])
            .select()
            .single();
        if (error) {
            // Check if column mismatch error (postgrest PGRST102 / PGRST116)
            if (error.code === 'PGRST102' || error.code === 'PGRST116' || error.message.includes('funding')) {
                console.warn("Database schema is missing columns. Falling back to safe schema...");
                const { funding, ...fallbackStudent } = insertData; // Keep avatar!
                let cleanName = insertData.name || '';
                if (cleanName.endsWith('(กยศ)')) cleanName = cleanName.slice(0, -6).trim();
                else if (cleanName.endsWith('(จ่ายเอง)')) cleanName = cleanName.slice(0, -10).trim();
                fallbackStudent.name = `${cleanName} (${insertData.funding || 'จ่ายเอง'})`;
                return this.addStudent(fallbackStudent);
            }
            throw error;
        }
        this.invalidateCache('students');
        return data;
    }

    async updateStudent(student) {
        const { id, ...updateData } = student;
        delete updateData.generation;
        delete updateData.theme; // Theme is stored locally

        const { data, error } = await this.supabase
            .from('students')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
        if (error) {
            // Check if column mismatch error (postgrest PGRST102 / PGRST116)
            if (error.code === 'PGRST102' || error.code === 'PGRST116' || error.message.includes('funding')) {
                console.warn("Database schema is missing columns. Falling back to safe schema...");
                const { funding, ...fallbackData } = updateData; // Keep avatar!
                let cleanName = student.name || '';
                if (cleanName.endsWith('(กยศ)')) cleanName = cleanName.slice(0, -6).trim();
                else if (cleanName.endsWith('(จ่ายเอง)')) cleanName = cleanName.slice(0, -10).trim();
                fallbackData.name = `${cleanName} (${student.funding || 'จ่ายเอง'})`;
                const { data: retryData, error: retryError } = await this.supabase
                    .from('students')
                    .update(fallbackData)
                    .eq('id', id)
                    .select()
                    .single();
                if (retryError) throw retryError;
                this.invalidateCache('students');
                return retryData || student;
            }
            throw error;
        }
        this.invalidateCache('students');
        return data || student;
    }

    async deleteStudent(id) {
        const { error } = await this.supabase
            .from('students')
            .delete()
            .eq('id', id);
        if (error) throw error;
        this.invalidateCache('students');
        return true;
    }

    // --- PAYMENT OPERATIONS ---

    async getPayments(excludeImage = false) {
        const cacheKey = excludeImage ? 'payments_light' : 'payments';
        const cached = this._getCached(cacheKey);
        if (cached) return cached;

        const columns = excludeImage 
            ? 'id, studentId, amount, dateTime, slipName, status, refNo, verificationDate, comment' 
            : '*';

        const { data, error } = await this.supabase
            .from('payments')
            .select(columns);
        if (error) throw error;
        const result = data || [];
        this._setCache(cacheKey, result);
        return result;
    }

    async getPaymentsByStudentId(studentId, excludeImage = false) {
        const cacheKey = excludeImage ? `payments_light_${studentId}` : `payments_${studentId}`;
        const cached = this._getCached(cacheKey);
        if (cached) return cached;

        const columns = excludeImage 
            ? 'id, studentId, amount, dateTime, slipName, status, refNo, verificationDate, comment' 
            : '*';

        const { data, error } = await this.supabase
            .from('payments')
            .select(columns)
            .eq('studentId', studentId)
            .order('dateTime', { ascending: false });
        if (error) throw error;
        const result = data || [];
        this._setCache(cacheKey, result);
        return result;
    }

    async addPayment(payment) {
        // ID is auto-generated by Supabase, remove it if it exists (e.g. from mock data)
        const { id, ...insertData } = payment;
        const { data, error } = await this.supabase
            .from('payments')
            .insert([insertData])
            .select()
            .single();
        if (error) throw error;
        this.invalidateCache(); // Clear all payment-related caches
        return data;
    }

    async updatePayment(payment) {
        const { id, ...updateData } = payment;
        const { data, error } = await this.supabase
            .from('payments')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        this.invalidateCache(); // Clear all payment-related caches
        return data || payment;
    }

    async getPaymentById(id) {
        const { data, error } = await this.supabase
            .from('payments')
            .select('*')
            .eq('id', id)
            .single();
        if (error && error.code === 'PGRST116') return null;
        if (error) throw error;
        return data;
    }

    async deletePayment(id) {
        const { error } = await this.supabase
            .from('payments')
            .delete()
            .eq('id', id);
        if (error) throw error;
        this.invalidateCache();
        return true;
    }

    async deletePaymentsByStudentId(studentId) {
        const { error } = await this.supabase
            .from('payments')
            .delete()
            .eq('studentId', studentId);
        if (error) throw error;
        this.invalidateCache();
        return true;
    }

    // --- SEED MOCK DATA ---

    async seedDataIfEmpty() {
        // Try to fetch students to see if table exists and is empty
        let students = [];
        try {
            students = await this.getStudents();
        } catch (e) {
            console.error("Supabase table might not exist yet. Please run the SQL script.");
            return;
        }

        if (students.length > 0) {
            return; // Database already seeded
        }

        console.log("Database empty. Seeding tuition payment mock data to Supabase...");

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
                verificationDate: null,
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

        console.log("Tuition Supabase Database Seeded successfully with mock PNG slips!");
    }

    /**
     * Utility method to generate a premium-looking base64 E-Slip image
     * rendered programmatically on a Canvas! This eliminates placeholder files and
     * creates an extremely authentic, beautiful demonstration!
     */
    generateMockSlipBase64(stdId, stdName, amount, dateStr, phoneStr) {
        const canvas = document.createElement('canvas');
        canvas.width = 460;
        canvas.height = 640;
        const ctx = canvas.getContext('2d');

        // Defaults
        const nameVal = stdName || 'วิริวัลย์ เปสุยะ';
        const idVal = stdId || 'STD002';
        const amountVal = amount ? parseFloat(amount) : 25.00;
        const dateVal = dateStr || '17 พ.ค. 2569 19:46';

        // Helper function to format Thai Date to exactly "17 พ.ค. 2569 - 19:46"
        function formatThaiDate(dateStr) {
            const thMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
            let d = new Date();
            
            // Check if it's already a formatted string containing "น." or "-"
            if (dateStr && (dateStr.includes('น.') || dateStr.includes('-'))) {
                return dateStr.replace(' น.', '').replace(/\s+/g, ' ');
            }
            
            if (dateStr) {
                // Try parsing standard formats like "12/05/2026 14:15"
                const parts = dateStr.split(/[\s/:-]+/);
                if (parts.length >= 5) {
                    const day = parseInt(parts[0]);
                    const month = parseInt(parts[1]) - 1;
                    let year = parseInt(parts[2]);
                    if (year < 2500) year += 543; // convert to BE
                    const hr = parts[3];
                    const min = parts[4];
                    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
                        return `${day} ${thMonths[month]} ${year} - ${hr}:${min}`;
                    }
                }
                
                const parsed = new Date(dateStr);
                if (!isNaN(parsed.getTime())) {
                    d = parsed;
                }
            }
            
            const day = d.getDate();
            const monthIndex = d.getMonth();
            const year = d.getFullYear() + 543; // BE
            const hr = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return `${day} ${thMonths[monthIndex]} ${year} - ${hr}:${min}`;
        }

        // 1. Draw Base Background (White with subtle guilloche security lines)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw light gray border around slip
        ctx.strokeStyle = '#e5e5ea';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);

        // Draw faint guilloche curves at the bottom
        ctx.save();
        ctx.strokeStyle = 'rgba(230, 100, 150, 0.02)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height - 150);
        ctx.bezierCurveTo(150, canvas.height - 200, 300, canvas.height - 100, canvas.width, canvas.height - 120);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(100, 150, 230, 0.02)';
        ctx.beginPath();
        ctx.moveTo(0, canvas.height - 120);
        ctx.bezierCurveTo(120, canvas.height - 80, 280, canvas.height - 180, canvas.width, canvas.height - 100);
        ctx.stroke();
        ctx.restore();

        // 2. Sky Blue Banner Gradient
        const bannerHeight = 140;
        const bannerGrad = ctx.createLinearGradient(0, 0, 0, bannerHeight);
        bannerGrad.addColorStop(0, '#59c2f6');
        bannerGrad.addColorStop(1, '#0e6fdf');
        ctx.fillStyle = bannerGrad;
        ctx.fillRect(0, 0, canvas.width, bannerHeight);

        // Sun Glow and clouds
        ctx.save();
        const sunGrad = ctx.createRadialGradient(80, 50, 0, 80, 50, 80);
        sunGrad.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
        sunGrad.addColorStop(0.2, 'rgba(255, 255, 230, 0.2)');
        sunGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = sunGrad;
        ctx.beginPath();
        ctx.arc(80, 50, 80, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.beginPath();
        ctx.arc(30, 110, 40, 0, Math.PI * 2);
        ctx.arc(70, 120, 35, 0, Math.PI * 2);
        ctx.arc(110, 125, 30, 0, Math.PI * 2);
        ctx.arc(0, 130, 50, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.arc(380, 120, 45, 0, Math.PI * 2);
        ctx.arc(420, 125, 35, 0, Math.PI * 2);
        ctx.arc(460, 130, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Kite
        ctx.save();
        ctx.translate(340, 45);
        ctx.rotate(Math.PI / 12);
        ctx.fillStyle = '#ffaa3b';
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(14, 0);
        ctx.lineTo(0, 18);
        ctx.lineTo(-14, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(0, 18);
        ctx.moveTo(-14, 0);
        ctx.lineTo(14, 0);
        ctx.stroke();
        ctx.restore();

        // Kite Tails
        ctx.save();
        ctx.strokeStyle = '#ffaa3b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(344, 62);
        ctx.bezierCurveTo(365, 80, 390, 65, 430, 75);
        ctx.moveTo(344, 62);
        ctx.bezierCurveTo(370, 95, 410, 80, 440, 95);
        ctx.stroke();
        ctx.restore();

        // Krungthai Logo in center of banner
        ctx.save();
        const logoX = canvas.width / 2 - 60;
        const logoY = 65;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(logoX + 15, logoY - 12);
        ctx.quadraticCurveTo(logoX + 25, logoY - 18, logoX + 32, logoY - 14);
        ctx.lineTo(logoX + 35, logoY - 16);
        ctx.lineTo(logoX + 33, logoY - 10);
        ctx.quadraticCurveTo(logoX + 40, logoY + 5, logoX + 30, logoY + 12);
        ctx.quadraticCurveTo(logoX + 15, logoY + 18, logoX + 8, logoY + 8);
        ctx.quadraticCurveTo(logoX, logoY - 2, logoX + 15, logoY - 12);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(logoX + 20, logoY + 2, 12, -Math.PI/2, Math.PI/2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(logoX + 20, logoY + 2, 7, -Math.PI/2, Math.PI/2);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px Arial, sans-serif';
        ctx.fillText('Krungthai', logoX + 48, logoY - 2);

        ctx.font = '500 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('กรุงไทย', logoX + 50, logoY + 14);
        ctx.restore();

        // 3. Green Circle Checkmark & "จ่ายบิลสำเร็จ"
        const contentY = 160;
        ctx.save();
        ctx.fillStyle = '#2cb713';
        ctx.beginPath();
        ctx.arc(45, contentY + 25, 20, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(37, contentY + 25);
        ctx.lineTo(42, 30 + contentY);
        ctx.lineTo(53, 19 + contentY);
        ctx.stroke();

        ctx.fillStyle = '#2cb713';
        ctx.font = 'bold 20px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('จ่ายบิลสำเร็จ', 80, contentY + 18);

        ctx.fillStyle = '#86868b';
        ctx.font = '12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('รหัสอ้างอิง', 80, contentY + 38);

        let refNo = 'C';
        try {
            const cleanDate = dateVal.replace(/[^0-9]/g, '');
            if (cleanDate.length >= 8) {
                refNo += cleanDate.substring(0, 8);
            } else {
                refNo += '20260517';
            }
        } catch (e) {
            refNo += '20260517';
        }
        refNo += String(Math.floor(100000000000 + Math.random() * 900000000000));
        ctx.fillStyle = '#86868b';
        ctx.font = '13px Arial, sans-serif';
        ctx.fillText(refNo, 80, contentY + 56);
        ctx.restore();

        // Draw QR Code on the right
        const qrX = 350;
        const qrY = contentY - 5;
        const qrSize = 75;
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX, qrY, qrSize, qrSize);

        ctx.fillStyle = '#000000';
        ctx.fillRect(qrX, qrY, 20, 20);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX + 4, qrY + 4, 12, 12);
        ctx.fillStyle = '#000000';
        ctx.fillRect(qrX + 6, qrY + 6, 8, 8);

        ctx.fillRect(qrX + qrSize - 20, qrY, 20, 20);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX + qrSize - 16, qrY + 4, 12, 12);
        ctx.fillStyle = '#000000';
        ctx.fillRect(qrX + qrSize - 14, qrY + 6, 8, 8);

        ctx.fillRect(qrX, qrY + qrSize - 20, 20, 20);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX + 4, qrY + qrSize - 16, 12, 12);
        ctx.fillStyle = '#000000';
        ctx.fillRect(qrX + 6, qrY + qrSize - 14, 8, 8);

        ctx.fillStyle = '#000000';
        for (let y = qrY + 24; y < qrY + qrSize; y += 4) {
            for (let x = qrX + 24; x < qrX + qrSize; x += 4) {
                if (Math.random() > 0.5) ctx.fillRect(x, y, 4, 4);
            }
        }
        for (let y = qrY; y < qrY + 20; y += 4) {
            for (let x = qrX + 24; x < qrX + qrSize - 20; x += 4) {
                if (Math.random() > 0.5) ctx.fillRect(x, y, 4, 4);
            }
        }
        for (let y = qrY + 24; y < qrY + qrSize - 20; y += 4) {
            for (let x = qrX; x < qrX + 20; x += 4) {
                if (Math.random() > 0.5) ctx.fillRect(x, y, 4, 4);
            }
        }
        ctx.restore();

        // 4. Sender Information (Krungthai Blue badge)
        const senderY = 245;
        ctx.save();
        ctx.fillStyle = '#00a2e5';
        ctx.beginPath();
        ctx.arc(45, senderY + 20, 18, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(39, senderY + 20);
        ctx.quadraticCurveTo(45, senderY + 12, 51, senderY + 17);
        ctx.moveTo(42, senderY + 22);
        ctx.quadraticCurveTo(45, senderY + 16, 48, senderY + 22);
        ctx.stroke();

        const nameParts = nameVal.split(/\s+/);
        const firstName = nameParts[0] || 'ศิระ';
        let lastName = nameParts[1] || 'ยอแสง';
        if (lastName.length > 0 && lastName !== 'ยอแสง') {
            lastName = lastName.charAt(0) + '***';
        } else if (lastName === 'ยอแสง') {
            lastName = 'ย***';
        }
        let prefix = '';
        if (!firstName.startsWith('นาย') && !firstName.startsWith('นาง') && !firstName.startsWith('น.ส.') && !firstName.startsWith('นางสาว') && !firstName.startsWith('ด.ช.') && !firstName.startsWith('ด.ญ.')) {
            prefix = firstName.includes('หญิง') || firstName.includes('พร') || firstName.includes('สาว') ? 'นางสาว' : 'นาย';
        }
        const displayName = `${prefix}${firstName} ${lastName}`;

        ctx.fillStyle = '#1d1d1f';
        ctx.font = 'bold 14px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText(displayName, 80, senderY + 12);

        ctx.fillStyle = '#5e6e82';
        ctx.font = '500 12px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('กรุงไทย', 80, senderY + 28);

        let accSuffix = '543-9';
        if (idVal) {
            const numOnly = idVal.replace(/\D/g, '');
            if (numOnly.length >= 3) {
                accSuffix = numOnly.slice(-3) + '-' + Math.floor(Math.random() * 10);
            }
        }
        const displayAcc = `XXX-X-XX${accSuffix}`;
        ctx.fillStyle = '#86868b';
        ctx.font = '12px Arial, sans-serif';
        ctx.fillText(displayAcc, 80, senderY + 44);

        // Connected arrows (dotted vertical line)
        ctx.strokeStyle = '#0ea5e9';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(45, senderY + 42);
        ctx.lineTo(45, senderY + 68);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.strokeStyle = '#0ea5e9';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(41, senderY + 63);
        ctx.lineTo(45, senderY + 68);
        ctx.lineTo(49, senderY + 63);
        ctx.stroke();
        ctx.restore();

        // 5. Receiver Information (Gray circle with ...)
        const receiverY = 325;
        ctx.save();
        ctx.fillStyle = '#f2f2f7';
        ctx.beginPath();
        ctx.arc(45, receiverY + 20, 18, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#5e6e82';
        ctx.beginPath();
        ctx.arc(39, receiverY + 20, 2.5, 0, Math.PI * 2);
        ctx.arc(45, receiverY + 20, 2.5, 0, Math.PI * 2);
        ctx.arc(51, receiverY + 20, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Dynamic receiver details based on amount
        let recName = 'วิทยาลัยเทคโนโลยีนนทบุรี';
        let recBranch = 'TUITION SYSTEM - ONLINE PORTAL';
        if (amountVal <= 100) {
            recName = 'PUNGWEIIHEII BY BAKE MAKER';
            recBranch = 'BRANCH KANCHANAPHISEK';
        }

        ctx.fillStyle = '#1d1d1f';
        ctx.font = 'bold 13px Arial, "Noto Sans Thai", sans-serif';
        ctx.fillText(recName.toUpperCase(), 80, receiverY + 14);

        ctx.font = 'bold 12px Arial, sans-serif';
        ctx.fillStyle = '#5e6e82';
        ctx.fillText(recBranch, 80, receiverY + 32);
        ctx.restore();

        // Divider
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.beginPath();
        ctx.moveTo(15, 390);
        ctx.lineTo(canvas.width - 15, 390);
        ctx.stroke();

        // 6. Transaction Details Grid
        const detailsX = 30;
        const rightAlignX = canvas.width - 30;
        ctx.save();

        // Merchant Code
        ctx.fillStyle = '#86868b';
        ctx.font = '500 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('รหัสร้านค้า', detailsX, 420);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#1d1d1f';
        ctx.font = '500 14px Arial, sans-serif';
        const merchantCode = amountVal <= 100 ? 'KB000001889785' : 'KB0400036053';
        ctx.fillText(merchantCode, rightAlignX, 420);

        // Transaction ID
        ctx.textAlign = 'left';
        ctx.fillStyle = '#86868b';
        ctx.font = '500 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('รหัสธุรกรรม', detailsX, 455);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#1d1d1f';
        ctx.font = '500 14px Arial, sans-serif';
        let txnId = 'APIC';
        const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (let i = 0; i < 16; i++) {
            txnId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        ctx.fillText(txnId, rightAlignX, 455);

        // Amount
        ctx.textAlign = 'left';
        ctx.fillStyle = '#86868b';
        ctx.font = '500 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('จำนวนเงิน', detailsX, 495);
        ctx.textAlign = 'right';
        ctx.font = 'bold 18px Arial, sans-serif';
        ctx.fillStyle = '#1d1d1f';
        const amountStr = amountVal.toLocaleString('th-TH', { minimumFractionDigits: 2 });
        ctx.fillText(amountStr, rightAlignX - 35, 495);
        ctx.font = '500 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('บาท', rightAlignX, 495);

        // Fee
        ctx.textAlign = 'left';
        ctx.fillStyle = '#86868b';
        ctx.font = '500 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('ค่าธรรมเนียม', detailsX, 535);
        ctx.textAlign = 'right';
        ctx.font = '500 14px Arial, sans-serif';
        ctx.fillText('0.00', rightAlignX - 35, 535);
        ctx.font = '500 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('บาท', rightAlignX, 535);

        // Transaction Date
        ctx.textAlign = 'left';
        ctx.fillStyle = '#86868b';
        ctx.font = '500 13px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText('วันที่ทำรายการ', detailsX, 575);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#1d1d1f';
        ctx.font = '500 13.5px "Noto Sans Thai", Arial, sans-serif';
        ctx.fillText(formatThaiDate(dateVal), rightAlignX, 575);

        ctx.restore();

        return canvas.toDataURL('image/png');
    }

    async saveIntroCard(studentId, cardId, imageBase64, commentText) {
        const uniqueRefNo = `CARD-${cardId}-${Date.now()}`;
        const paymentData = {
            studentId: studentId,
            amount: 0,
            dateTime: new Date().toISOString().slice(0, 19),
            slipImage: imageBase64,
            slipName: `card_${cardId}_${Date.now()}.png`,
            status: 'card_new',
            refNo: uniqueRefNo,
            verificationDate: new Date().toISOString().slice(0, 19),
            comment: commentText || 'ภาพฝึกงานนักศึกษา'
        };

        // Always insert new record for multiple uploads support
        const { data, error } = await this.supabase
            .from('payments')
            .insert([paymentData])
            .select()
            .single();
        if (error) throw error;
        this.invalidateCache();
        return data;
    }

    /**
     * Fetch all saved student intro cards from the database.
     */
    async getIntroCards() {
        const cached = this._getCached('intro_cards');
        if (cached) return cached;

        const { data, error } = await this.supabase
            .from('payments')
            .select('*')
            .in('status', ['card', 'card_new'])
            .order('dateTime', { ascending: false });
        if (error) throw error;
        
        const result = data || [];
        this._setCache('intro_cards', result);
        return result;
    }

    /**
     * Delete student intro card.
     */
    async deleteIntroCard(paymentId) {
        const { error } = await this.supabase
            .from('payments')
            .delete()
            .eq('id', paymentId);
        if (error) throw error;
        this.invalidateCache();
        return true;
    }
}

// Global instance
window.tuitionStore = new TuitionStore();
