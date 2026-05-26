/**
 * Tuition Payment Portal - Main Application Logic
 * Integrates database persistence, slip conversion to PNG, drag-and-drop uploads,
 * automated slip generation, admin validation dashboard, and receipts.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Current Application State
    const state = {
        currentStudent: null,
        selectedPaymentMode: 'full', // 'full' or 'custom'
        uploadedSlipBase64: null,
        uploadedSlipName: null,
        
        // Admin View state
        activeAdminTab: 'vault', // 'vault' or 'students'
        inspectorPaymentId: null,
        zoomLevel: 1.0,
        rotationAngle: 0,
        
        // Countdown timer
        timerInterval: null
    };

    // Cross-tab Synchronization Channel
    const syncChannel = new BroadcastChannel('tuition_sync');

    syncChannel.onmessage = async (event) => {
        const { type, table, studentId } = event.data;
        if (type === 'DB_UPDATE') {
            // 1. Re-render student grid on login screen
            renderStudentMockGrid();
            
            // 2. If the logged-in student's data is updated, refresh their dashboard
            if (state.currentStudent && state.currentStudent.id === studentId) {
                await refreshStudentDashboard();
            }
            
            // 3. If admin is logged in, refresh the admin dashboard
            if (sessionStorage.getItem('adminLoggedIn') === 'true') {
                await updateAdminDashboard();
                
                // If the slip inspector is open for the updated payment/student, reload the viewer
                if (state.inspectorPaymentId) {
                    const activePayment = await window.tuitionStore.getPaymentById(state.inspectorPaymentId);
                    if (activePayment) {
                        // Reload the viewer image and status
                        const viewerImg = document.getElementById('inspector-slip-img');
                        if (viewerImg) viewerImg.src = activePayment.slipImage;
                        
                        const actionBtnGroup = document.getElementById('inspector-actions-group');
                        const rejectionContainer = document.getElementById('rejection-reason-container');
                        
                        if (activePayment.status === 'pending') {
                            if (actionBtnGroup) actionBtnGroup.style.display = 'flex';
                            if (rejectionContainer) rejectionContainer.style.display = 'none';
                        } else {
                            if (actionBtnGroup) actionBtnGroup.style.display = 'none';
                            if (activePayment.status === 'rejected') {
                                if (rejectionContainer) {
                                    rejectionContainer.style.display = 'block';
                                    const commentInput = document.getElementById('input-rejection-comment');
                                    if (commentInput) {
                                        commentInput.value = activePayment.comment || '';
                                        commentInput.setAttribute('readonly', 'true');
                                    }
                                }
                            } else {
                                if (rejectionContainer) rejectionContainer.style.display = 'none';
                            }
                        }
                    } else {
                        // Inspector payment was deleted or not found
                        const inspectorPanel = document.getElementById('slip-inspector');
                        if (inspectorPanel) inspectorPanel.classList.remove('active');
                        state.inspectorPaymentId = null;
                    }
                }
            }
        }
    };

    async function notifyDbUpdate(table, studentId) {
        // 1. Re-render student grid on login screen
        renderStudentMockGrid();
        
        // 2. If the logged-in student's data is updated, refresh their dashboard
        if (state.currentStudent && state.currentStudent.id === studentId) {
            await refreshStudentDashboard();
        }
        
        // 3. If admin is logged in, refresh the admin dashboard
        if (sessionStorage.getItem('adminLoggedIn') === 'true') {
            await updateAdminDashboard();
        }
        
        // 4. Broadcast to other tabs/windows
        syncChannel.postMessage({
            type: 'DB_UPDATE',
            table,
            studentId
        });
    }

    // Initialize application
    initApp();

    async function initApp() {
        try {
            // 1. Initialize DB Store
            await window.tuitionStore.init();
            
            // 2. Setup Navigation
            setupNavigation();
            
            // 3. Setup Student Auth & Profiles
            renderStudentMockGrid();
            setupStudentAuth();
            
            // 4. Setup Student Payment Panel
            setupStudentPayment();
            
            // 5. Setup Admin Panel
            setupAdminPanel();
            
            // 6. Setup Slip Inspector Controls
            setupSlipInspector();

            // 7. Setup Avatar Upload
            setupAvatarUpload();

            // 8. Preload Lottie success checkmark to bypass local file CORS boundaries
            try {
                const lottiePlayer = document.getElementById('lottie-success-player');
                if (lottiePlayer && typeof lottiePlayer.load === 'function' && typeof LOTTIE_SUCCESS_JSON !== 'undefined') {
                    lottiePlayer.load(LOTTIE_SUCCESS_JSON);
                    console.log("Lottie success checkmark preloaded from memory.");
                }
            } catch (e) {
                console.warn("Lottie player not ready for preload yet:", e);
            }

            console.log("Tuition Payment Application Initialized successfully!");
        } catch (err) {
            console.error("Initialization failure:", err);
            alert("เกิดข้อผิดพลาดในการติดตั้งระบบฐานข้อมูลของบราวเซอร์ กรุณารีเฟรชหน้าเว็บ");
        }
    }

    // =========================================================================
    // NAVIGATION & VIEW ROUTING
    // =========================================================================
    function setupNavigation() {
        const tabs = document.querySelectorAll('.app-header .nav-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Update visual active state immediately
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const targetViewId = tab.getAttribute('data-target');
                
                // Do not switch header tabs if inside student dashboard or admin dashboard
                // unless explicitly logging out.
                if (targetViewId === 'view-student-auth') {
                    if (state.currentStudent) {
                        switchView('view-student-portal');
                        refreshStudentDashboard();
                        return;
                    }
                }
                
                if (targetViewId === 'view-admin-auth') {
                    // Check if already authenticated as Admin
                    if (sessionStorage.getItem('adminLoggedIn') === 'true') {
                        switchView('view-admin-portal');
                        updateAdminDashboard();
                        return;
                    }
                }
                
                // Normal view switch
                switchView(targetViewId);
            });
        });

        // Logo click goes home / student auth
        document.getElementById('btn-logo-home').addEventListener('click', (e) => {
            e.preventDefault();
            if (state.currentStudent) {
                switchView('view-student-portal');
            } else {
                document.getElementById('tab-student-portal').click();
            }
        });
    }

    function switchView(viewId) {
        const sections = document.querySelectorAll('.view-section');
        
        sections.forEach(sec => {
            if (sec.id === viewId) {
                sec.classList.remove('hidden');
                // บังคับให้ CSS Animation เริ่มใหม่ทุกครั้งที่เปลี่ยนหน้าเพื่อความลื่นไหล
                sec.style.animation = 'none';
                void sec.offsetWidth; // Trigger reflow
                sec.style.animation = ''; 
            } else {
                sec.classList.add('hidden');
            }
        });
        
        // เอา smooth scroll ออกตอนเปลี่ยนหน้า เพราะมันจะตีกับ Animation SlideUp ทำให้จอมันกระตุก
        window.scrollTo(0, 0);
    }

    // =========================================================================
    // STUDENT AUTHENTICATION & PROFILES
    // =========================================================================
    async function renderStudentMockGrid() {
        const grid = document.getElementById('mock-students-grid');
        grid.innerHTML = '';
        
        const students = await window.tuitionStore.getStudents();
        
        students.forEach(student => {
            const card = document.createElement('div');
            card.className = 'premium-student-row-card';
            
            let statusText = '';
            let badgeClass = '';
            if (student.status === 'paid') {
                statusText = 'จ่ายครบแล้ว';
                badgeClass = 'badge-paid';
            } else if (student.status === 'installment') {
                statusText = 'ค้างจ่ายบางส่วน';
                badgeClass = 'badge-pending';
            } else if (student.status === 'pending') {
                statusText = 'รอตรวจสลิป';
                badgeClass = 'badge-pending';
            } else if (student.status === 'rejected') {
                statusText = 'สลิปถูกปฏิเสธ';
                badgeClass = 'badge-rejected';
            } else {
                statusText = 'ยังไม่ได้ชำระ';
                badgeClass = 'badge-unpaid';
            }

            // Calculate paid percentage (หลอดแสดงผล)
            const progressPct = Math.min(100, Math.round((student.paidAmount / student.totalTuition) * 100));
            const progressBarColor = progressPct >= 100 
                ? 'var(--success)' 
                : 'linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%)';

            const remaining = student.totalTuition - student.paidAmount;

            let actionBtnHtml = '';
            if (remaining > 0) {
                actionBtnHtml = `
                    <button class="btn-modern btn-modern-primary btn-modern-sm btn-pay-action" style="min-width: 110px; font-weight: 700;">
                        <i class="fa-solid fa-credit-card"></i> ชำระเงิน
                    </button>
                `;
            } else {
                actionBtnHtml = `
                    <button class="btn-modern btn-modern-sm btn-pay-action" style="min-width: 110px; font-weight: 700; background: var(--success); color: white; box-shadow: 0 4px 12px rgba(52, 199, 89, 0.2);">
                        <i class="fa-solid fa-receipt"></i> ดูใบเสร็จ
                    </button>
                `;
            }

            card.innerHTML = `
                <div class="student-card-content">
                    <!-- Left Section: Profile Info -->
                    <div class="student-card-profile">
                        <div class="student-card-avatar">
                            <img src="${student.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=e2e8f0'}" alt="Avatar">
                        </div>
                        <div class="student-card-details">
                            <div class="student-card-name">${student.name}</div>
                            <div class="student-card-meta">
                                <span class="student-card-tag-id">ID: ${student.id}</span>
                                <span class="student-card-tag-room">ห้อง ${student.room}</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Center Section: Progress Bar (หลอดแสดงผลชำระเงิน) -->
                    <div class="student-card-progress-section">
                        <div class="student-card-progress-header">
                            <span class="student-card-status-label">สถานะ: <span class="status-badge ${badgeClass}" style="padding: 2px 8px; font-size: 10.5px; vertical-align: middle;">${statusText}</span></span>
                            <span class="student-card-amount-label">ชำระแล้ว ${student.paidAmount.toLocaleString()} / ${student.totalTuition.toLocaleString()} บ.</span>
                        </div>
                        <!-- Progress Bar (หลอดแสดง) -->
                        <div class="student-card-progress-bar-bg">
                            <div class="student-card-progress-bar-fill ${student.status === 'paid' ? 'progress-rainbow' : ''}" style="width: ${progressPct}%;"></div>
                        </div>
                    </div>
                    
                    <!-- Right Section: Action Pay Button -->
                    <div class="student-card-actions">
                        ${actionBtnHtml}
                    </div>
                </div>
            `;
            
            // Row card click logs in the student directly
            card.addEventListener('click', () => {
                logInStudent(student);
            });
            
            grid.appendChild(card);
        });
    }

    // Handle avatar image upload
    function setupAvatarUpload() {
        const uploadInput = document.getElementById('avatar-upload');
        const avatarImg = document.getElementById('student-display-avatar');
        
        if (!uploadInput || !avatarImg) return;
        
        uploadInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64Str = e.target.result;
                avatarImg.src = base64Str;
                
                if (state.currentStudent) {
                    state.currentStudent.avatar = base64Str;
                    await window.tuitionStore.updateStudent(state.currentStudent);
                    await notifyDbUpdate('students', state.currentStudent.id);
                }
            };
            reader.readAsDataURL(file);
        });
    }

    function setupStudentAuth() {
        const inputId = document.getElementById('input-student-id');
        const loginBtn = document.getElementById('btn-student-login');
        const errorMsg = document.getElementById('student-login-error');

        if (loginBtn && inputId) {
            loginBtn.addEventListener('click', async () => {
                const studentId = inputId.value.trim().toUpperCase();
                if (!studentId) return;

                const student = await window.tuitionStore.getStudentById(studentId);
                if (student) {
                    errorMsg.style.display = 'none';
                    logInStudent(student);
                } else {
                    errorMsg.style.display = 'block';
                }
            });

            inputId.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') loginBtn.click();
            });
        }

        // Student logout click
        document.getElementById('btn-student-logout').addEventListener('click', () => {
            state.currentStudent = null;
            sessionStorage.removeItem('currentStudentId');
            
            // Clear payment form inputs and previews
            resetPaymentForm();
            
            // Clear interval
            if (state.timerInterval) clearInterval(state.timerInterval);

            // Re-render mock profile status list and switch view
            renderStudentMockGrid();
            switchView('view-student-auth');
        });
    }

    async function logInStudent(student) {
        state.currentStudent = student;
        sessionStorage.setItem('currentStudentId', student.id);
        
        // Set header active state
        document.querySelectorAll('.app-header .nav-tab').forEach(t => t.classList.remove('active'));
        document.getElementById('tab-student-portal').classList.add('active');

        // Update Student View Info
        document.getElementById('student-display-name').textContent = student.name;
        document.getElementById('student-display-meta').textContent = `รหัส: ${student.id} • ห้อง ${student.room}`;
        
        const avatarImg = document.getElementById('student-display-avatar');
        if (avatarImg) {
            avatarImg.src = student.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=e2e8f0';
        }
        
        // Refresh dashboard details
        await refreshStudentDashboard();
        
        // Show Portal View
        switchView('view-student-portal');
        
        // Start simulated Countdown timer
        startQRCountdown();
    }

    // =========================================================================
    // STUDENT PORTAL / DASHBOARD
    // =========================================================================
    async function refreshStudentDashboard() {
        if (!state.currentStudent) return;
        const student = await window.tuitionStore.getStudentById(state.currentStudent.id);
        state.currentStudent = student;

        // 1. Update tuition progress values
        const total = student.totalTuition;
        const paid = student.paidAmount;
        const remaining = total - paid;
        const pct = Math.round((paid / total) * 100);

        document.getElementById('ledger-total-fee').textContent = `${total.toLocaleString()} THB`;
        document.getElementById('ledger-paid-fee').textContent = `${paid.toLocaleString()} THB`;
        document.getElementById('ledger-remaining-fee').textContent = `${remaining.toLocaleString()} THB`;
        
        // Update circular ring progress
        const circle = document.getElementById('ledger-progress-circle');
        const radius = circle.r.baseVal.value;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (pct / 100) * circumference;
        circle.style.strokeDashoffset = offset;
        
        document.getElementById('ledger-percentage-val').textContent = `${pct}%`;

        // 2. Status Badge Header
        const badge = document.getElementById('student-status-badge');
        badge.className = 'status-badge';
        
        if (student.status === 'paid') {
            badge.classList.add('badge-paid');
            badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> ชำระเงินเสร็จสิ้น`;
        } else if (student.status === 'installment') {
            badge.classList.add('badge-pending');
            badge.innerHTML = `<i class="fa-solid fa-rotate"></i> ชำระแบ่งจ่ายสะสม`;
        } else if (student.status === 'pending') {
            badge.classList.add('badge-pending');
            badge.innerHTML = `<i class="fa-solid fa-clock"></i> รอเจ้าหน้าที่ตรวจสลิป`;
        } else if (student.status === 'rejected') {
            badge.classList.add('badge-rejected');
            badge.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> หลักฐานถูกปฏิเสธ`;
        } else {
            badge.classList.add('badge-unpaid');
            badge.innerHTML = `<i class="fa-solid fa-circle-minus"></i> ค้างชำระเต็มจำนวน`;
        }

        // 3. Hide / Show Payment form vs fully paid success card
        const payPanel = document.getElementById('payment-action-panel');
        const successCard = document.getElementById('fully-paid-success-card');
        
        if (remaining <= 0) {
            payPanel.style.display = 'none';
            successCard.style.display = 'block';
        } else {
            payPanel.style.display = 'block';
            successCard.style.display = 'none';
            
            // Set input amount label to show remaining tuition balance
            const lblPayAmount = document.getElementById('lbl-pay-amount');
            if (lblPayAmount) {
                lblPayAmount.textContent = `ระบุจำนวนเงินที่ต้องการชำระ (บาท) - ค้างจ่ายอีก ${remaining.toLocaleString()} บาท`;
            }
            
            // Update inputs constraints
            const customInput = document.getElementById('input-pay-amount');
            customInput.max = remaining;
            customInput.value = ''; // Keep blank so they type it themselves
            
            // Render dynamic PromptPay QR code
            renderPromptPayQR();
        }

        // 4. Draw payment history timeline
        await renderPaymentTimeline();
    }

    async function renderPaymentTimeline() {
        const container = document.getElementById('payment-timeline-container');
        const emptyState = document.getElementById('timeline-empty-state');
        container.innerHTML = '';

        const payments = await window.tuitionStore.getPaymentsByStudentId(state.currentStudent.id);
        
        if (payments.length === 0) {
            emptyState.style.display = 'block';
            return;
        } else {
            emptyState.style.display = 'none';
        }

        payments.forEach(payment => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            
            let statusText = '';
            let statusClass = '';
            let actionBtn = '';
            
            if (payment.status === 'approved') {
                statusText = 'อนุมัติเรียบร้อย';
                statusClass = 'status-approved';
                actionBtn = `<button class="btn-modern btn-modern-secondary btn-modern-sm btn-view-receipt" data-payment-id="${payment.id}"><i class="fa-solid fa-file-invoice"></i> ดูสลิป</button>`;
            } else if (payment.status === 'rejected') {
                statusText = 'เอกสารไม่ผ่าน (ต้องอัปโหลดสลิปใหม่)';
                statusClass = 'status-rejected';
                actionBtn = `<div style="font-size: 11px; color: var(--danger-text); font-weight: 600; margin-top: 4px; padding: 6px 12px; background: var(--danger-bg); border-radius: 8px; border: 1px dashed rgba(255, 59, 48, 0.2);"><i class="fa-solid fa-circle-info"></i> ${payment.comment || 'สลิปไม่ตรงเงื่อนไข'}</div>`;
            } else {
                statusText = 'กำลังตรวจสอบหลักฐาน';
                statusClass = 'status-pending';
                actionBtn = `<span style="font-size: 12px; color: var(--warning-text); font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-spinner fa-spin"></i> รอดำเนินการ...</span>`;
            }

            const formattedDate = new Date(payment.dateTime).toLocaleString('th-TH', {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
            }).replace(':', '.');

            item.innerHTML = `
                <div class="timeline-node ${statusClass}"></div>
                <div class="timeline-content">
                    <div class="timeline-details">
                        <div class="timeline-amount">${payment.amount > 0 ? payment.amount.toLocaleString() + ' THB' : '<span style="font-size:12px; color:#86868b; font-weight:500;">(ไม่ได้ระบุยอด)</span>'}</div>
                        <div class="timeline-meta">โอนวันที่: ${formattedDate}</div>
                        <div class="timeline-meta" style="font-weight: 600; color: var(--neutral-dark);">สถานะ: ${statusText}</div>

                    </div>
                    <div>
                        ${actionBtn}
                    </div>
                </div>
            `;
            
            container.appendChild(item);
        });

        // Add event listeners to newly rendered receipt buttons
        document.querySelectorAll('.btn-view-receipt').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const payId = btn.getAttribute('data-payment-id');
                await showReceiptModal(payId);
            });
        });
    }

    // =========================================================================
    // PAYMENT FORM LOGIC & PNG CONVERSION & DRAG-DROP
    // =========================================================================
    function setupStudentPayment() {
        const customField = document.getElementById('custom-amount-field');
        const customInput = document.getElementById('input-pay-amount');
        const customErr = document.getElementById('custom-amount-error');
        const dropzone = document.getElementById('slip-dropzone');
        const fileInput = document.getElementById('input-slip-file');
        
        state.selectedPaymentMode = 'custom';
        if (customField) customField.style.display = 'block';


        // Prevent scroll wheel from changing numbers when focused
        customInput.addEventListener('wheel', (e) => {
            e.preventDefault();
        }, { passive: false });

        customInput.addEventListener('input', () => {
            const val = parseFloat(customInput.value);
            const remaining = state.currentStudent.totalTuition - state.currentStudent.paidAmount;
            
            if (val > remaining) {
                customErr.style.display = 'block';
                customInput.style.borderColor = 'var(--danger)';
            } else {
                customErr.style.display = 'none';
                customInput.style.borderColor = 'var(--primary)';
            }
        });

        // Drag & Drop event bindings
        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
            }, false);
        });

        dropzone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) handleUploadedSlip(files[0]);
        });

        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleUploadedSlip(e.target.files[0]);
        });

        // Remove uploaded slip preview
        document.getElementById('btn-remove-slip').addEventListener('click', () => {
            state.uploadedSlipBase64 = null;
            state.originalUploadedSlipBase64 = null;
            state.uploadedSlipName = null;
            
            const badge = document.getElementById('slip-interactive-badge');
            if (badge) badge.style.display = 'none';
            
            document.getElementById('slip-preview-container').style.display = 'none';
            document.getElementById('slip-preview-img').src = '';
            document.getElementById('input-slip-file').value = '';
        });

        // DEMO E-SLIP GENERATOR (BIG FEATURE!)
        // Change: Now opens the customizer modal instead of generating instantly!
        const btnDemoGenSlip = document.getElementById('btn-demo-gen-slip');
        if (btnDemoGenSlip) {
            btnDemoGenSlip.addEventListener('click', () => {
            if (!state.currentStudent) return;
            
            const stdNameField = document.getElementById('edit-slip-std-name');
            const stdIdField = document.getElementById('edit-slip-std-id');
            const phoneField = document.getElementById('edit-slip-phone');
            const amountField = document.getElementById('edit-slip-amount');
            const dateField = document.getElementById('edit-slip-date');

            // Default suggestions based on current student context
            stdNameField.value = state.currentStudent.name + " รุ่น21";
            stdIdField.value = "รหัส" + state.currentStudent.id.replace(/\D/g, '');
            if (!stdIdField.value || stdIdField.value === 'รหัส') {
                stdIdField.value = "รหัส" + state.currentStudent.id;
            }
            phoneField.value = "081-132-2816"; // Sample phone

            // Read the current amount inside input-pay-amount (if empty, read remaining balance)
            const inputVal = parseFloat(document.getElementById('input-pay-amount').value);
            const remaining = state.currentStudent.totalTuition - state.currentStudent.paidAmount;
            amountField.value = !isNaN(inputVal) && inputVal > 0 ? inputVal : remaining;

            // Date formatting in Thai Buddhist calendar short form
            const thMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
            const now = new Date();
            const day = now.getDate();
            const month = thMonths[now.getMonth()];
            const yr = (now.getFullYear() + 543) % 100;
            const hr = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            
            dateField.value = `${day} ${month} ${yr} ${hr}:${min} น.`;

            // Display modal
            document.getElementById('modal-edit-slip').style.display = 'flex';
        });
        }

        // Close Edit Slip Modal
        const closeEditSlipModal = () => {
            document.getElementById('modal-edit-slip').style.display = 'none';
        };

        document.getElementById('btn-close-edit-slip').addEventListener('click', closeEditSlipModal);
        document.getElementById('btn-cancel-edit-slip').addEventListener('click', closeEditSlipModal);
        document.getElementById('modal-edit-slip').addEventListener('click', (e) => {
            if (e.target.id === 'modal-edit-slip') closeEditSlipModal();
        });

        // =========================================================================
        // ONE-CLICK SLIP STAMPER LOGIC (SUPER EASY STUDENT FEATURE!)
        // =========================================================================
        const btnOpenStampModal = document.getElementById('btn-open-stamp-modal');
        const modalStampSlip = document.getElementById('modal-stamp-slip');
        const btnCloseStamp = document.getElementById('btn-close-stamp');
        const btnCancelStamp = document.getElementById('btn-cancel-stamp');
        const formStampSlip = document.getElementById('form-stamp-slip');

        const closeStampModal = () => {
            modalStampSlip.style.display = 'none';
        };

        if (btnOpenStampModal) {
            btnOpenStampModal.addEventListener('click', () => {
                if (!state.currentStudent || !state.uploadedSlipBase64) {
                    alert("❌ กรุณาแนบไฟล์ภาพสลิปชำระเงินก่อนใช้งานฟีเจอร์นี้");
                    return;
                }

                // Pre-fill student context details dynamically
                document.getElementById('stamp-slip-name').value = document.getElementById('stamp-badge-name').textContent;
                document.getElementById('stamp-slip-id').value = document.getElementById('stamp-badge-id').textContent;
                document.getElementById('stamp-slip-phone').value = document.getElementById('stamp-badge-room').textContent;

                modalStampSlip.style.display = 'flex';
            });
        }

        if (btnCloseStamp) btnCloseStamp.addEventListener('click', closeStampModal);
        if (btnCancelStamp) btnCancelStamp.addEventListener('click', closeStampModal);
        if (modalStampSlip) {
            modalStampSlip.addEventListener('click', (e) => {
                if (e.target.id === 'modal-stamp-slip') closeStampModal();
            });
        }

        if (formStampSlip) {
            formStampSlip.addEventListener('submit', (e) => {
                e.preventDefault();
                
                const nameVal = document.getElementById('stamp-slip-name').value.trim();
                const idVal = document.getElementById('stamp-slip-id').value.trim();
                const phoneVal = document.getElementById('stamp-slip-phone').value.trim();

                if (!nameVal || !idVal || !phoneVal) {
                    alert("❌ กรุณากรอกข้อมูลให้ครบทุกช่อง");
                    return;
                }

                // Update text inside interactive draggable badge overlay
                document.getElementById('stamp-badge-name').textContent = nameVal;
                document.getElementById('stamp-badge-id').textContent = idVal;
                document.getElementById('stamp-badge-room').textContent = phoneVal;

                // Close modal
                closeStampModal();
            });
        }

        // Initialize Draggable Stamp Overlay (Disabled as user requested static top-right corner badge)
        /*
        const interactiveBadge = document.getElementById('slip-interactive-badge');
        const previewContainer = document.getElementById('slip-preview-container');
        
        if (interactiveBadge && previewContainer) {
            let isDragging = false;
            let startX, startY;
            let initialLeft, initialTop;

            interactiveBadge.addEventListener('mousedown', dragStart);
            interactiveBadge.addEventListener('touchstart', dragStart, { passive: true });

            function dragStart(e) {
                isDragging = true;
                const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
                const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
                
                startX = clientX;
                startY = clientY;
                
                initialLeft = interactiveBadge.offsetLeft;
                initialTop = interactiveBadge.offsetTop;

                document.addEventListener('mousemove', dragMove);
                document.addEventListener('touchmove', dragMove, { passive: false });
                document.addEventListener('mouseup', dragEnd);
                document.addEventListener('touchend', dragEnd);
            }

            function dragMove(e) {
                if (!isDragging) return;
                
                if (e.cancelable) e.preventDefault();

                const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
                const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

                const dx = clientX - startX;
                const dy = clientY - startY;

                let newLeft = initialLeft + dx;
                let newTop = initialTop + dy;

                const maxLeft = previewContainer.clientWidth - interactiveBadge.clientWidth;
                const maxTop = previewContainer.clientHeight - interactiveBadge.clientHeight;

                newLeft = Math.max(0, Math.min(newLeft, maxLeft));
                newTop = Math.max(0, Math.min(newTop, maxTop));

                interactiveBadge.style.left = newLeft + 'px';
                interactiveBadge.style.top = newTop + 'px';
                interactiveBadge.style.right = 'auto'; // release right constraint if initially set in css
            }

            function dragEnd() {
                isDragging = false;
                document.removeEventListener('mousemove', dragMove);
                document.removeEventListener('touchmove', dragMove);
                document.removeEventListener('mouseup', dragEnd);
                document.removeEventListener('touchend', dragEnd);
            }
        }
        */

        // Submit form inside Edit Slip Modal to generate bespoke PNG Base64 E-Slip
        document.getElementById('form-edit-slip').addEventListener('submit', (e) => {
            e.preventDefault();
            if (!state.currentStudent) return;

            const name = document.getElementById('edit-slip-std-name').value.trim();
            const id = document.getElementById('edit-slip-std-id').value.trim();
            const phone = document.getElementById('edit-slip-phone').value.trim();
            const amount = parseFloat(document.getElementById('edit-slip-amount').value) || 0;
            const dateStr = document.getElementById('edit-slip-date').value.trim();

            // Generate custom K+ Base64 PNG
            const base64Png = window.tuitionStore.generateMockSlipBase64(id, name, amount, dateStr, phone);

            state.uploadedSlipBase64 = base64Png;
            state.originalUploadedSlipBase64 = base64Png; // Store clean original mockup slip backup
            state.uploadedSlipName = `slip_${state.currentStudent.id}_custom.png`;

            // Reset and populate draggable HTML badge texts/locations
            const badge = document.getElementById('slip-interactive-badge');
            if (badge) {
                const last4 = state.currentStudent.id.replace(/\D/g, '').slice(-4) || state.currentStudent.id.slice(-4);
                let genText = state.currentStudent.generation || '-';
                if (genText !== '-' && !genText.startsWith('รุ่น')) genText = 'รุ่น ' + genText;
                document.getElementById('stamp-badge-name').textContent = `${genText} รหัส ${last4} ห้อง ${state.currentStudent.room || '-'}`;
                document.getElementById('stamp-badge-id').textContent = state.currentStudent.name;
                
                // Reset position strictly to top-right corner
                badge.style.display = 'block';
                badge.style.top = '2.5cqw';
                badge.style.left = 'auto';
                badge.style.right = '2.5cqw';
            }

            // Display in Preview
            const previewContainer = document.getElementById('slip-preview-container');
            const previewImg = document.getElementById('slip-preview-img');
            previewImg.src = base64Png;
            previewContainer.style.display = 'block';

            // Clear error if present
            document.getElementById('slip-error').style.display = 'none';

            // Close Modal
            closeEditSlipModal();

            // Notify user of success
            alert("🎉 สร้างและแนบภาพสลิปจำลองที่แก้ไขเรียบร้อยแล้ว!");
        });

        // COPY BANK ACCOUNT BUTTON
        document.getElementById('btn-copy-acc').addEventListener('click', () => {
            const accNo = document.getElementById('txt-bank-acc').textContent;
            navigator.clipboard.writeText(accNo.replace(/-/g, ''));
            
            const btnIcon = document.getElementById('btn-copy-acc').querySelector('i');
            btnIcon.className = 'fa-solid fa-circle-check';
            btnIcon.style.color = 'var(--success)';
            
            setTimeout(() => {
                btnIcon.className = 'fa-regular fa-copy';
                btnIcon.style.color = '#86868b';
            }, 1500);
        });

        // FORM SUBMIT PAYMENT EVIDENCE
        document.getElementById('form-tuition-payment').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Validate inputs
            const payAmount = getFinalPayAmount();
            const remaining = state.currentStudent.totalTuition - state.currentStudent.paidAmount;
            
            if (payAmount > remaining || payAmount <= 0) {
                document.getElementById('custom-amount-error').style.display = 'block';
                return;
            }
            
            if (!state.uploadedSlipBase64) {
                document.getElementById('slip-error').style.display = 'block';
                return;
            }

            // If uploader stamp badge is visible, burn/stamp it into the raw clean uploaded image copy strictly at the top-right corner!
            const badge = document.getElementById('slip-interactive-badge');
            
            if (badge && badge.style.display !== 'none' && state.originalUploadedSlipBase64) {
                // Show custom visual indicator during render
                const submitBtn = document.querySelector('#form-tuition-payment button[type="submit"]');
                const origHtml = submitBtn.innerHTML;
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังประมวลผลรูปภาพ...';

                // Canvas high-resolution stamping block
                const stampedSlip = await new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        
                        // Draw raw base image
                        ctx.drawImage(img, 0, 0);
                        
                        const width = canvas.width;
                        const height = canvas.height;
                        const scale = width / 600;
                        
                        const fontSize = Math.max(23 * scale, 19);
                        const padding = 18 * scale;
                        const lineSpacing = 8 * scale;
                        
                        // Calculate sizes
                        const boxWidth = 370 * scale;
                        const boxHeight = (fontSize * 2) + lineSpacing + (padding * 2.2);
                        
                        // Target coordinates fixed strictly at top-right corner (margin 2.5% of width)
                        const gap = 0.025 * width;
                        const targetX = width - boxWidth - gap;
                        const targetY = gap;
                        
                        // Soft premium drop shadow
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
                        ctx.shadowBlur = 12 * scale;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 4 * scale;
                        
                        // Draw white rounded rect
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                        const r = 12 * scale;
                        ctx.beginPath();
                        ctx.moveTo(targetX + r, targetY);
                        ctx.lineTo(targetX + boxWidth - r, targetY);
                        ctx.quadraticCurveTo(targetX + boxWidth, targetY, targetX + boxWidth, targetY + r);
                        ctx.lineTo(targetX + boxWidth, targetY + boxHeight - r);
                        ctx.quadraticCurveTo(targetX + boxWidth, targetY + boxHeight, targetX + boxWidth - r, targetY + boxHeight);
                        ctx.lineTo(targetX + r, targetY + boxHeight);
                        ctx.quadraticCurveTo(targetX, targetY + boxHeight, targetX, targetY + boxHeight - r);
                        ctx.lineTo(targetX, targetY + r);
                        ctx.quadraticCurveTo(targetX, targetY, targetX + r, targetY);
                        ctx.closePath();
                        ctx.fill();
                        
                        // Reset shadow
                        ctx.shadowColor = 'transparent';
                        ctx.shadowBlur = 0;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                        
                        // Blue border stroke
                        ctx.strokeStyle = 'rgba(0, 102, 204, 0.25)';
                        ctx.lineWidth = 2 * scale;
                        ctx.stroke();
                        
                        // Slate text details
                        ctx.fillStyle = '#1d1d1f';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        
                        const nameText = document.getElementById('stamp-badge-name').textContent;
                        const idText = document.getElementById('stamp-badge-id').textContent;
                        
                        // Draw 2 lines on canvas
                        ctx.font = `600 ${fontSize * 0.82}px 'Noto Sans Thai', sans-serif`;
                        ctx.fillText(nameText, targetX + (boxWidth / 2), targetY + padding);
                        ctx.font = `bold ${fontSize}px 'Noto Sans Thai', sans-serif`;
                        ctx.fillText(idText, targetX + (boxWidth / 2), targetY + padding + fontSize + lineSpacing);
                        
                        resolve(canvas.toDataURL('image/png'));
                    };
                    img.src = state.originalUploadedSlipBase64;
                });
                
                state.uploadedSlipBase64 = stampedSlip;
                submitBtn.disabled = false;
                submitBtn.innerHTML = origHtml;
            }

            // Valid payment, submit
            const payment = {
                studentId: state.currentStudent.id,
                amount: payAmount,
                dateTime: new Date().toISOString().slice(0, 19),
                slipImage: state.uploadedSlipBase64,
                slipName: state.uploadedSlipName,
                status: 'pending',
                refNo: `TXN-${state.currentStudent.id}-${Math.floor(Date.now() / 100000)}`,
                verificationDate: '',
                comment: ''
            };

            // 1. Save payment record
            await window.tuitionStore.addPayment(payment);
            
            // 2. Set student status to pending
            const student = await window.tuitionStore.getStudentById(state.currentStudent.id);
            student.status = 'pending';
            await window.tuitionStore.updateStudent(student);
            
            // 3. Clear form
            resetPaymentForm();
            
            // 5. Success Modal pop up
            const successModal = document.getElementById('modal-success-checkmark');
            const lottiePlayer = document.getElementById('lottie-success-player');
            if (successModal) {
                if (lottiePlayer) {
                    if (typeof lottiePlayer.load === 'function' && typeof LOTTIE_SUCCESS_JSON !== 'undefined') {
                        try {
                            lottiePlayer.load(LOTTIE_SUCCESS_JSON);
                        } catch (e) {
                            console.error("Error loading Lottie JSON on display:", e);
                        }
                    }
                    if (typeof lottiePlayer.seek === 'function') {
                        lottiePlayer.seek(0);
                    }
                    if (typeof lottiePlayer.play === 'function') {
                        lottiePlayer.play();
                    }
                }
                successModal.style.display = 'flex';
                setTimeout(() => {
                    successModal.classList.add('active');
                }, 10);
                
                let dismissed = false;
                const dismissModal = () => {
                    if (dismissed) return;
                    dismissed = true;
                    successModal.classList.remove('active');
                    setTimeout(() => {
                        successModal.style.display = 'none';
                        if (lottiePlayer && typeof lottiePlayer.stop === 'function') {
                            lottiePlayer.stop();
                        }
                    }, 300);
                };

                const autoDismissTimeout = setTimeout(dismissModal, 2200);

                successModal.onclick = () => {
                    clearTimeout(autoDismissTimeout);
                    dismissModal();
                };
            }
            
            // 6. Sync and refresh view across tabs and current tab
            await notifyDbUpdate('payments', state.currentStudent.id);
        });

        // =========================================================================
        // KTB MOBILE BANKING DEEP LINK SYSTEM
        // =========================================================================
        const btnOpenBanking = document.getElementById('btn-open-banking-app');
        const modalSelectBank = document.getElementById('modal-select-bank');
        const btnCloseBankModal = document.getElementById('btn-close-bank-modal');
        
        if (btnOpenBanking && modalSelectBank) {
            btnOpenBanking.addEventListener('click', () => {
                const val = parseFloat(customInput.value) || 0;
                const remaining = state.currentStudent.totalTuition - state.currentStudent.paidAmount;
                if (val <= 0 || val > remaining) {
                    alert('❌ กรุณาระบุยอดชำระเงินที่ถูกต้องก่อนเปิดแอปธนาคาร!');
                    return;
                }
                modalSelectBank.classList.add('active');
            });
        }
        
        if (btnCloseBankModal && modalSelectBank) {
            btnCloseBankModal.addEventListener('click', () => {
                modalSelectBank.classList.remove('active');
                const overlay = document.getElementById('bank-overlay-notice');
                if (overlay) overlay.style.display = 'none';
            });
        }
        
        document.querySelectorAll('.bank-app-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const bankName = btn.getAttribute('data-bank');
                const schemeUrl = btn.getAttribute('data-scheme');
                const payAmount = parseFloat(customInput.value) || 0;
                
                // Copy account details & amount to clipboard
                try {
                    const clipboardText = `เลขที่บัญชี: 040-0-03605-3\nยอดเงินโอน: ${payAmount.toLocaleString()} บาท\nธนาคารกรุงไทย\nชื่อบัญชี: วิทยาลัยเทคโนโลยียานยนต์`;
                    await navigator.clipboard.writeText(clipboardText);
                } catch (err) {
                    console.error('Failed to copy to clipboard:', err);
                }
                
                // Show dynamic status indicator
                const overlay = document.getElementById('bank-overlay-notice');
                const overlayText = document.getElementById('bank-overlay-text');
                if (overlay && overlayText) {
                    overlayText.textContent = `📋 คัดลอกเลขบัญชี 040-0-03605-3 และยอด ${payAmount.toLocaleString()} บ. ลงในคลิปบอร์ดแล้ว! กำลังเปิดแอป ${bankName}...`;
                    overlay.style.display = 'block';
                }
                
                // Fire deep link redirection
                setTimeout(() => {
                    window.location.href = schemeUrl;
                }, 1300);
            });
        });
    }

    /**
     * Handles file input & drag and drop files.
     * Crucial constraint: Processes file on canvas to force-convert it into a PNG file structure!
     */
    function handleUploadedSlip(file) {
        // Validate is image
        if (!file.type.match('image.*')) {
            alert("❌ กรุณาเลือกอัปโหลดเฉพาะไฟล์ภาพสลิปเท่านั้น (.jpg, .jpeg, .png)");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Force convert/render on canvas to export as PNG!
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // EXPORTS STRICTLY AS PNG FILE IMAGE
                const pngDataUrl = canvas.toDataURL('image/png');
                
                state.uploadedSlipBase64 = pngDataUrl;
                state.originalUploadedSlipBase64 = pngDataUrl; // Store raw clean original slip backup
                
                // Force file extension to be strictly png
                const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                state.uploadedSlipName = `${baseName}_converted.png`;

                // Reset and populate draggable HTML badge texts/locations
                const badge = document.getElementById('slip-interactive-badge');
                if (badge) {
                    const last4 = state.currentStudent.id.replace(/\D/g, '').slice(-4) || state.currentStudent.id.slice(-4);
                    let genText = state.currentStudent.generation || '-';
                    if (genText !== '-' && !genText.startsWith('รุ่น')) genText = 'รุ่น ' + genText;
                    document.getElementById('stamp-badge-name').textContent = `${genText} รหัส ${last4} ห้อง ${state.currentStudent.room || '-'}`;
                    document.getElementById('stamp-badge-id').textContent = state.currentStudent.name;
                    
                    // Reset position strictly to top-right corner
                    badge.style.display = 'block';
                    badge.style.top = '2.5cqw';
                    badge.style.left = 'auto';
                    badge.style.right = '2.5cqw';
                }

                // Display Preview
                const previewContainer = document.getElementById('slip-preview-container');
                const previewImg = document.getElementById('slip-preview-img');
                previewImg.src = pngDataUrl;
                previewContainer.style.display = 'block';
                
                // Clear errors
                document.getElementById('slip-error').style.display = 'none';
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function getFinalPayAmount() {
        const inputVal = parseFloat(document.getElementById('input-pay-amount').value);
        if (!isNaN(inputVal) && inputVal > 0) {
            return inputVal;
        }
        return 0;
    }

    function resetPaymentForm() {
        state.uploadedSlipBase64 = null;
        state.uploadedSlipName = null;
        const previewContainer = document.getElementById('slip-preview-container');
        if (previewContainer) previewContainer.style.display = 'none';
        
        const previewImg = document.getElementById('slip-preview-img');
        if (previewImg) previewImg.src = '';
        
        const fileInput = document.getElementById('input-slip-file');
        if (fileInput) fileInput.value = '';
        
        const customInput = document.getElementById('input-pay-amount');
        if (customInput && state.currentStudent) {
            customInput.value = '';
        } else if (customInput) {
            customInput.value = '';
        }
        
        state.selectedPaymentMode = 'custom';
    }

    // =========================================================================
    // PROMPTPAY DYNAMIC QR CODE SIMULATOR
    // =========================================================================
    function renderPromptPayQR() {
        const container = document.getElementById('qr-container');
        if (!container) return;
        container.innerHTML = '';

        const amount = getFinalPayAmount();
        if (amount <= 0) return;

        // Draw PromtPay simulated QR code elegantly on Canvas!
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext('2d');

        // 1. Draw PromtPay Logo Bar
        ctx.fillStyle = '#0f2446'; // Navy background blue
        ctx.fillRect(0, 0, canvas.width, 24);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Prompt Pay', canvas.width / 2, 15);

        // 2. Draw mock QR Pattern grid
        ctx.fillStyle = '#000000';
        // Left-Top finder pattern
        ctx.fillRect(8, 32, 28, 28);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(12, 36, 20, 20);
        ctx.fillStyle = '#000000';
        ctx.fillRect(16, 40, 12, 12);

        // Right-Top finder pattern
        ctx.fillRect(canvas.width - 36, 32, 28, 28);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(canvas.width - 32, 36, 20, 20);
        ctx.fillStyle = '#000000';
        ctx.fillRect(canvas.width - 28, 40, 12, 12);

        // Left-Bottom finder pattern
        ctx.fillRect(8, canvas.height - 36, 28, 28);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(12, canvas.height - 32, 20, 20);
        ctx.fillStyle = '#000000';
        ctx.fillRect(16, canvas.height - 28, 12, 12);

        // Draw randomized binary QR code blocks in the middle!
        ctx.fillStyle = '#000000';
        // Generate reproducible rows of mock patterns using sum value
        const seedValue = amount + 77;
        for (let y = 32; y < canvas.height - 8; y += 4) {
            for (let x = 8; x < canvas.width - 8; x += 4) {
                // Skip corner finder zones
                if ((x < 40 && y < 64) || (x > canvas.width - 44 && y < 64) || (x < 40 && y > canvas.height - 44)) {
                    continue;
                }
                const rand = Math.abs(Math.sin(x * y + seedValue));
                if (rand > 0.45) {
                    ctx.fillRect(x, y, 4, 4);
                }
            }
        }

        // Draw PromtPay emblem in center
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(canvas.width / 2 - 14, canvas.height / 2 + 2 - 14, 28, 28);
        ctx.fillStyle = '#4c8ef2'; // Accent blue
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2 + 2, 10, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px Arial';
        ctx.fillText('QR', canvas.width / 2, canvas.height / 2 + 5);

        container.appendChild(canvas);

        // Update Scan instructions with precise amount
        const instruct = document.createElement('div');
        instruct.style.textAlign = 'center';
        instruct.style.fontWeight = '700';
        instruct.style.fontSize = '14px';
        instruct.style.marginTop = '6px';
        instruct.style.color = '#0f2446';
        instruct.textContent = `${amount.toLocaleString()} บ.`;
        container.appendChild(instruct);
    }

    function startQRCountdown() {
        const timerText = document.getElementById('qr-countdown-timer');
        if (!timerText) return;
        
        if (state.timerInterval) clearInterval(state.timerInterval);
        
        let seconds = 900; // 15 minutes

        state.timerInterval = setInterval(() => {
            seconds--;
            if (seconds <= 0) {
                clearInterval(state.timerInterval);
                timerText.textContent = "QR Code หมดอายุ กรุณารีเฟรชเพื่อชำระเงินใหม่";
                timerText.style.color = 'var(--danger)';
                return;
            }

            const m = Math.floor(seconds / 60);
            const s = seconds % 60;
            timerText.textContent = `สแกนชำระเงินภายใน ${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} นาที`;
            timerText.style.color = 'var(--danger)';
        }, 1000);
    }


    // =========================================================================
    // ADMIN PORTAL - STATISTICS & TABS
    // =========================================================================
    function setupAdminPanel() {
        const loginForm = document.getElementById('form-admin-login');
        const passwordInput = document.getElementById('input-admin-password');
        const loginError = document.getElementById('admin-login-error');
        const logoutBtn = document.getElementById('btn-admin-logout');

        // Log out admin
        logoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem('adminLoggedIn');
            switchView('view-admin-auth');
            document.querySelectorAll('.app-header .nav-tab').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-admin-portal').classList.add('active');
        });

        // Admin authentication submit
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const password = passwordInput.value.trim();

            if (password === '1234') { // Exact Admin password
                loginError.style.display = 'none';
                passwordInput.value = '';
                sessionStorage.setItem('adminLoggedIn', 'true');
                
                // Transition view
                switchView('view-admin-portal');
                updateAdminDashboard();
            } else {
                loginError.style.display = 'block';
            }
        });

        // Admin Tabs switching
        const tabVault = document.getElementById('btn-admin-tab-vault');
        const tabStudents = document.getElementById('btn-admin-tab-students');
        const contentVault = document.getElementById('admin-tab-vault');
        const contentStudents = document.getElementById('admin-tab-students');

        tabVault.addEventListener('click', () => {
            if (state.activeAdminTab === 'vault') return;
            tabVault.classList.add('active');
            tabStudents.classList.remove('active');
            contentVault.style.display = 'block';
            contentStudents.style.display = 'none';
            state.activeAdminTab = 'vault';
            updateAdminDashboard();
        });

        tabStudents.addEventListener('click', () => {
            if (state.activeAdminTab === 'students') return;
            tabStudents.classList.add('active');
            tabVault.classList.remove('active');
            contentStudents.style.display = 'block';
            contentVault.style.display = 'none';
            state.activeAdminTab = 'students';
            updateAdminDashboard();
        });

        // Filter vault status table selector
        document.getElementById('select-filter-vault-status').addEventListener('change', () => {
            renderAdminVaultList();
        });

        // Add Student trigger modal
        document.getElementById('btn-admin-add-student-trigger').addEventListener('click', () => {
            document.getElementById('modal-add-student').classList.add('active');
        });

        document.getElementById('btn-close-add-student-modal').addEventListener('click', () => {
            document.getElementById('modal-add-student').classList.remove('active');
        });
        document.getElementById('btn-cancel-add-student').addEventListener('click', () => {
            document.getElementById('modal-add-student').classList.remove('active');
        });

        // Add Student Form submit
        document.getElementById('form-admin-add-student').addEventListener('submit', async (e) => {
            e.preventDefault();

            const student = {
                id: document.getElementById('add-student-id').value.trim().toUpperCase(),
                name: document.getElementById('add-student-name').value.trim(),
                generation: document.getElementById('add-student-generation').value.trim(),
                room: document.getElementById('add-student-room').value.trim(),
                totalTuition: parseFloat(document.getElementById('add-student-tuition').value) || 60000,
                paidAmount: 0,
                status: 'unpaid'
            };

            // Check if student id duplicate
            const exist = await window.tuitionStore.getStudentById(student.id);
            if (exist) {
                alert(`❌ รหัสนักเรียน ${student.id} มีในฐานข้อมูลอยู่แล้ว!`);
                return;
            }

            await window.tuitionStore.addStudent(student);
            
            // Success
            alert(`🎉 เพิ่มข้อมูลนักเรียน ${student.name} สำเร็จ!`);
            document.getElementById('form-admin-add-student').reset();
            document.getElementById('modal-add-student').classList.remove('active');
            
            // Refresh and sync across tabs and current tab
            await notifyDbUpdate('students', student.id);
        });

        // Edit Student trigger modals
        document.getElementById('btn-close-edit-student-modal').addEventListener('click', () => {
            document.getElementById('modal-edit-student').classList.remove('active');
        });
        document.getElementById('btn-cancel-edit-student').addEventListener('click', () => {
            document.getElementById('modal-edit-student').classList.remove('active');
        });

        document.getElementById('btn-delete-student-modal').addEventListener('click', async () => {
            const stdId = document.getElementById('edit-student-old-id').value.trim();
            if (!stdId) return;

            const confirmDelete = confirm(`⚠️ คุณแน่ใจหรือไม่ที่จะลบข้อมูลนักเรียนรหัส ${stdId} ?\nการดำเนินการนี้จะลบประวัติการชำระเงินและไฟล์สลิปของนักเรียนคนนี้ทั้งหมด!`);
            
            if (confirmDelete) {
                await window.tuitionStore.deleteStudent(stdId);
                
                // Also delete their payments
                const payments = await window.tuitionStore.getPaymentsByStudentId(stdId);
                for (const p of payments) {
                    const { store } = window.tuitionStore.getTransaction('payments', 'readwrite');
                    store.delete(p.id);
                }
                
                alert("🗑️ ลบข้อมูลนักเรียนเรียบร้อยแล้ว");
                document.getElementById('modal-edit-student').classList.remove('active');
                await notifyDbUpdate('students', stdId);
            }
        });

        // Edit Student Form submit
        document.getElementById('form-admin-edit-student').addEventListener('submit', async (e) => {
            e.preventDefault();

            const oldId = document.getElementById('edit-student-old-id').value.trim();
            const newId = document.getElementById('edit-student-id').value.trim().toUpperCase();
            const student = await window.tuitionStore.getStudentById(oldId);
            
            if (!student) return;

            // Check if changing ID to an existing one
            if (oldId !== newId) {
                const exist = await window.tuitionStore.getStudentById(newId);
                if (exist) {
                    alert(`❌ รหัสนักเรียน ${newId} มีในฐานข้อมูลอยู่แล้ว!`);
                    return;
                }
            }

            student.generation = document.getElementById('edit-student-generation').value.trim();
            student.id = newId;
            student.room = document.getElementById('edit-student-room').value.trim();
            student.name = document.getElementById('edit-student-name').value.trim();

            if (oldId !== newId) {
                await window.tuitionStore.deleteStudent(oldId);
                await window.tuitionStore.addStudent(student);
                
                // Update all payments to point to new ID
                const payments = await window.tuitionStore.getPaymentsByStudentId(oldId);
                for (const p of payments) {
                    p.studentId = newId;
                    await window.tuitionStore.updatePayment(p);
                }
            } else {
                await window.tuitionStore.updateStudent(student);
            }
            
            alert(`✅ แก้ไขข้อมูลนักเรียน ${student.name} สำเร็จ!`);
            document.getElementById('form-admin-edit-student').reset();
            document.getElementById('modal-edit-student').classList.remove('active');
            
            await notifyDbUpdate('students', student.id);
        });

        // Search Student input
        document.getElementById('input-search-student').addEventListener('input', () => {
            renderAdminStudentsList();
        });
    }

    async function updateAdminDashboard() {
        const students = await window.tuitionStore.getStudents();
        const payments = await window.tuitionStore.getPayments();

        // 1. Calculate Analytics
        let totalApprovedCollected = 0;
        let totalOutstanding = 0;
        let pendingVerificationsCount = 0;

        payments.forEach(p => {
            if (p.status === 'approved') totalApprovedCollected += p.amount;
            if (p.status === 'pending') pendingVerificationsCount++;
        });

        students.forEach(s => {
            totalOutstanding += (s.totalTuition - s.paidAmount);
        });

        const targetTuitionGoal = students.length * 60000;
        const colPercent = targetTuitionGoal > 0 ? Math.round((totalApprovedCollected / targetTuitionGoal) * 100) : 0;

        // Render stat values
        const elTotalCollected = document.getElementById('stat-total-collected');
        if (elTotalCollected) elTotalCollected.textContent = `${totalApprovedCollected.toLocaleString()} THB`;
        
        const elCollectedPct = document.getElementById('stat-collected-pct');
        if (elCollectedPct) elCollectedPct.textContent = `${colPercent}%`;
        
        const elPendingSlips = document.getElementById('stat-pending-slips');
        if (elPendingSlips) elPendingSlips.textContent = pendingVerificationsCount;
        
        const elOutstandingFees = document.getElementById('stat-outstanding-fees');
        if (elOutstandingFees) elOutstandingFees.textContent = `${totalOutstanding.toLocaleString()} THB`;
        
        const elTotalStudents = document.getElementById('stat-total-students');
        if (elTotalStudents) elTotalStudents.textContent = students.length;

        // Alert text logic
        const pendingStatus = document.getElementById('stat-pending-status');
        if (pendingStatus) {
            if (pendingVerificationsCount > 0) {
                pendingStatus.innerHTML = `<span class="pulse-indicator" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--warning); margin-right: 4px; animation: pulse 1.5s infinite;"></span> รอดำเนินการ ${pendingVerificationsCount} รายการ`;
                pendingStatus.style.color = 'var(--warning-text)';
            } else {
                pendingStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> เรียบร้อยดี`;
                pendingStatus.style.color = 'var(--success-text)';
            }
        }

        // 2. Render active lists
        if (state.activeAdminTab === 'vault') {
            await renderAdminVaultList();
        } else {
            await renderAdminStudentsList();
        }

        // 3. Keep Student Auth Profiles synchronized
        await renderStudentMockGrid();
    }

    async function renderAdminVaultList() {
        const tbody = document.getElementById('admin-vault-table-body');
        const emptyState = document.getElementById('vault-empty-state');

        const payments = await window.tuitionStore.getPayments();
        const filterVal = document.getElementById('select-filter-vault-status').value;

        // Filter transaction list
        const filtered = payments.filter(p => {
            if (filterVal === 'all') return true;
            return p.status === filterVal;
        }).sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
            tbody.closest('table').style.display = 'none';
            return;
        } else {
            emptyState.style.display = 'none';
            tbody.closest('table').style.display = 'table';
        }

        const fragment = document.createDocumentFragment();

        for (const payment of filtered) {
            const student = await window.tuitionStore.getStudentById(payment.studentId);
            const stdName = student ? student.name : 'Unknown';

            const row = document.createElement('tr');
            
            let badgeClass = '';
            let statusText = '';
            let actionBtn = '';

            if (payment.status === 'approved') {
                statusText = 'อนุมัติแล้ว';
                badgeClass = 'badge-paid';
                actionBtn = `<button class="btn-modern btn-modern-secondary btn-modern-sm btn-admin-view-slip" data-payment-id="${payment.id}"><i class="fa-solid fa-eye"></i> ดูใบสลิป PNG</button>`;
            } else if (payment.status === 'rejected') {
                statusText = 'ปฏิเสธหลักฐาน';
                badgeClass = 'badge-rejected';
                actionBtn = `<button class="btn-modern btn-modern-secondary btn-modern-sm btn-admin-view-slip" data-payment-id="${payment.id}"><i class="fa-solid fa-eye"></i> ดูภาพความขัดแย้ง</button>`;
            } else {
                statusText = 'รอดำเนินการ';
                badgeClass = 'badge-pending';
                actionBtn = `<button class="btn-modern btn-modern-primary btn-modern-sm btn-admin-inspect" data-payment-id="${payment.id}"><i class="fa-solid fa-magnifying-glass"></i> ตรวจสอบสลิป</button>`;
            }

            const formattedDate = new Date(payment.dateTime).toLocaleString('th-TH', {
                year: '2-digit', month: 'short', day: 'numeric'
            });

            row.innerHTML = `
                <td style="font-weight: 700;">
                    <div>${stdName}</div>
                    <div style="font-size: 11px; color:#86868b;">ID: ${payment.studentId}</div>
                </td>
                <td style="font-weight: 800; color: var(--primary);">${payment.amount > 0 ? payment.amount.toLocaleString() + ' บ.' : '<span style="font-weight:500; font-size:12px; color:#86868b;">ไม่ระบุยอด</span>'}</td>
                <td>${formattedDate}</td>
                <td>
                    <span style="font-family: monospace; font-size: 11px; color: var(--primary);"><i class="fa-regular fa-image"></i> ${payment.slipName || 'slip.png'}</span>
                </td>
                <td>
                    <span class="status-badge ${badgeClass}">${statusText}</span>
                </td>
                <td style="text-align: center;">
                    ${actionBtn}
                </td>
            `;

            fragment.appendChild(row);
        }

        tbody.innerHTML = '';
        tbody.appendChild(fragment);

        // Action attachments
        document.querySelectorAll('.btn-admin-inspect, .btn-admin-view-slip').forEach(btn => {
            btn.addEventListener('click', async () => {
                const payId = btn.getAttribute('data-payment-id');
                await openSlipInspector(payId);
            });
        });
    }

    async function renderAdminStudentsList() {
        const tbody = document.getElementById('admin-students-table-body');

        const students = await window.tuitionStore.getStudents();
        
        tbody.innerHTML = '';
        const query = document.getElementById('input-search-student').value.trim().toLowerCase();

        const filtered = students.filter(s => {
            if (!query) return true;
            return s.id.toLowerCase().includes(query) || 
                   s.name.toLowerCase().includes(query) || 
                   s.room.toLowerCase().includes(query);
        });

        filtered.forEach(s => {
            const remaining = s.totalTuition - s.paidAmount;
            
            let statusText = '';
            let badgeClass = '';
            if (s.status === 'paid') {
                statusText = 'ครบถ้วน';
                badgeClass = 'badge-paid';
            } else if (s.status === 'installment') {
                statusText = 'จ่ายสะสม';
                badgeClass = 'badge-pending';
            } else if (s.status === 'pending') {
                statusText = 'รอตรวจยอด';
                badgeClass = 'badge-pending';
            } else if (s.status === 'rejected') {
                statusText = 'สลิปไม่ผ่าน';
                badgeClass = 'badge-rejected';
            } else {
                statusText = 'ยังไม่ชำระ';
                badgeClass = 'badge-unpaid';
            }

            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="text-align: center; font-weight: 600;">${s.generation || '-'}</td>
                <td style="text-align: center; font-family: monospace; font-weight: 700;">${s.id}</td>
                <td style="text-align: center; font-weight: 500;">${s.room}</td>
                <td style="text-align: center; font-weight: 700;">${s.name}</td>
                <td style="text-align: center; font-weight: 700; color: var(--success);">${s.paidAmount.toLocaleString()} บ.</td>
                <td style="text-align: center; font-weight: 800; color: var(--danger);">${remaining.toLocaleString()} บ.</td>
                <td style="text-align: center;">
                    <button class="btn-modern btn-modern-secondary btn-modern-sm btn-edit-student" data-std-id="${s.id}" style="color: var(--primary); border-color: rgba(79, 70, 229, 0.2);" title="แก้ไขข้อมูล">
                        <i class="fa-solid fa-pen"></i> แก้ไข
                    </button>
                </td>
            `;

            tbody.appendChild(row);
        });

        // Delete events moved to modal

        // Attach edit events
        document.querySelectorAll('.btn-edit-student').forEach(btn => {
            btn.addEventListener('click', async () => {
                const stdId = btn.getAttribute('data-std-id');
                const student = await window.tuitionStore.getStudentById(stdId);
                if (student) {
                    document.getElementById('edit-student-old-id').value = student.id;
                    document.getElementById('edit-student-generation').value = student.generation || '';
                    document.getElementById('edit-student-id').value = student.id;
                    document.getElementById('edit-student-room').value = student.room || '';
                    document.getElementById('edit-student-name').value = student.name || '';
                    document.getElementById('modal-edit-student').classList.add('active');
                }
            });
        });
    }

    // =========================================================================
    // SLIP INSPECTOR PANEL (VERIFICATION & MANIPULATION CONTROLS)
    // =========================================================================
    async function openSlipInspector(paymentId) {
        state.inspectorPaymentId = paymentId;
        
        const payment = await window.tuitionStore.getPaymentById(paymentId);
        if (!payment) return;

        const student = await window.tuitionStore.getStudentById(payment.studentId);
        const stdName = student ? student.name : 'Unknown';

        // Set inspector headers & info details
        document.getElementById('inspector-student-name').textContent = `ตรวจสอบสลิป • คุณ${stdName}`;
        document.getElementById('inspector-payment-meta').textContent = `TXN: ${payment.refNo} • นักเรียน: ${payment.studentId}`;
        
        document.getElementById('inspector-detail-amount').textContent = payment.amount > 0 ? `${payment.amount.toLocaleString()} บาท` : 'ไม่ระบุยอด (อ้างอิงจากสลิป)';
        
        const formattedDate = new Date(payment.dateTime).toLocaleString('th-TH', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
        }).replace(':', '.');
        document.getElementById('inspector-detail-datetime').textContent = `${formattedDate} น.`;
        document.getElementById('inspector-detail-filename').textContent = payment.slipName || 'slip.png';

        // Load Converted PNG image into viewport
        const viewerImg = document.getElementById('inspector-slip-img');
        viewerImg.src = payment.slipImage;

        // Reset transforms
        state.zoomLevel = 1.0;
        state.rotationAngle = 0;
        applyViewerTransforms();

        // Control buttons displays
        const actionBtnGroup = document.getElementById('inspector-actions-group');
        const rejectionContainer = document.getElementById('rejection-reason-container');
        document.getElementById('input-rejection-comment').value = '';

        if (payment.status === 'pending') {
            actionBtnGroup.style.display = 'flex';
            rejectionContainer.style.display = 'none';
        } else {
            actionBtnGroup.style.display = 'none';
            // Show comments if rejected
            if (payment.status === 'rejected') {
                rejectionContainer.style.display = 'block';
                document.getElementById('input-rejection-comment').value = payment.comment || '';
                // Make reason read-only
                document.getElementById('input-rejection-comment').setAttribute('readonly', 'true');
            } else {
                rejectionContainer.style.display = 'none';
            }
        }

        // Slide panel in
        document.getElementById('slip-inspector').classList.add('active');
    }

    function setupSlipInspector() {
        const inspector = document.getElementById('slip-inspector');
        const viewerImg = document.getElementById('inspector-slip-img');

        // Close button
        document.getElementById('btn-close-inspector').addEventListener('click', () => {
            inspector.classList.remove('active');
            state.inspectorPaymentId = null;
        });

        // 1. ZOOM IN CONTROLS
        document.getElementById('btn-zoom-in').addEventListener('click', () => {
            state.zoomLevel += 0.2;
            if (state.zoomLevel > 3.0) state.zoomLevel = 3.0; // limit zoom
            applyViewerTransforms();
        });

        // 2. ZOOM OUT CONTROLS
        document.getElementById('btn-zoom-out').addEventListener('click', () => {
            state.zoomLevel -= 0.2;
            if (state.zoomLevel < 0.5) state.zoomLevel = 0.5; // limit scale
            applyViewerTransforms();
        });

        // 3. ROTATION CONTROLS
        document.getElementById('btn-rotate').addEventListener('click', () => {
            state.rotationAngle += 90;
            if (state.rotationAngle >= 360) state.rotationAngle = 0;
            applyViewerTransforms();
        });

        // 4. RESET CONTROLS
        document.getElementById('btn-viewer-reset').addEventListener('click', () => {
            state.zoomLevel = 1.0;
            state.rotationAngle = 0;
            applyViewerTransforms();
        });

        // 5. DOWNLOAD EXACT PNG FILE IN browser STORAGE!
        document.getElementById('btn-viewer-download').addEventListener('click', async () => {
            if (!state.inspectorPaymentId) return;
            const payment = await window.tuitionStore.getPaymentById(state.inspectorPaymentId);
            if (!payment) return;

            // Trigger file download using binary dataUrl
            const a = document.createElement('a');
            a.href = payment.slipImage;
            a.download = payment.slipName || `slip_${payment.studentId}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });

        // ADMIN DECISION: REJECT
        document.getElementById('btn-admin-reject-slip').addEventListener('click', async () => {
            const reasonBox = document.getElementById('rejection-reason-container');
            const reasonInput = document.getElementById('input-rejection-comment');

            if (reasonBox.style.display === 'none') {
                // Open comment box
                reasonBox.style.display = 'block';
                reasonInput.removeAttribute('readonly');
                reasonInput.focus();
                
                // Change reject button text to confirm
                document.getElementById('btn-admin-reject-slip').textContent = "ยืนยันปฏิเสธเอกสาร";
            } else {
                const comment = reasonInput.value.trim();
                if (!comment) {
                    alert("❌ กรุณากรอกเหตุผลที่ปฏิเสธสลิปการโอนเงิน");
                    return;
                }

                // Process Rejection
                const payment = await window.tuitionStore.getPaymentById(state.inspectorPaymentId);
                payment.status = 'rejected';
                payment.comment = comment;
                payment.verificationDate = new Date().toISOString();
                await window.tuitionStore.updatePayment(payment);

                // Update Student status
                const student = await window.tuitionStore.getStudentById(payment.studentId);
                student.status = 'rejected';
                await window.tuitionStore.updateStudent(student);

                // Done
                alert("สลิปการโอนเงินนี้ถูก ปฏิเสธ เรียบร้อยแล้ว");
                inspector.classList.remove('active');
                state.inspectorPaymentId = null;
                
                // Re-initialize Reject button text
                document.getElementById('btn-admin-reject-slip').textContent = "ปฏิเสธสลิป";

                // Refresh and sync across tabs and current tab
                await notifyDbUpdate('payments', payment.studentId);
            }
        });

        // ADMIN DECISION: APPROVE PAYMENT
        document.getElementById('btn-admin-approve-slip').addEventListener('click', async () => {
            if (!state.inspectorPaymentId) return;

            const payment = await window.tuitionStore.getPaymentById(state.inspectorPaymentId);
            if (!payment) return;

            // Approve transaction
            payment.status = 'approved';
            payment.verificationDate = new Date().toISOString();
            payment.comment = "ตรวจสอบข้อมูลสลิปสำเร็จ ได้รับยอดเรียบร้อย";
            await window.tuitionStore.updatePayment(payment);

            // Add sum to Student Paid Amount
            const student = await window.tuitionStore.getStudentById(payment.studentId);
            
            student.paidAmount += payment.amount;
            
            // Check if fully paid
            if (student.paidAmount >= student.totalTuition) {
                student.status = 'paid';
            } else {
                student.status = 'installment';
            }

            await window.tuitionStore.updateStudent(student);

            // Immediately close the inspector panel
            inspector.classList.remove('active');
            state.inspectorPaymentId = null;

            // Show Success Modal
            const successModal = document.getElementById('modal-success-checkmark');
            const lottiePlayer = document.getElementById('lottie-success-player');
            if (successModal) {
                if (lottiePlayer) {
                    if (typeof lottiePlayer.load === 'function' && typeof LOTTIE_SUCCESS_JSON !== 'undefined') {
                        try {
                            lottiePlayer.load(LOTTIE_SUCCESS_JSON);
                        } catch (e) {
                            console.error("Error loading Lottie JSON on display:", e);
                        }
                    }
                    if (typeof lottiePlayer.seek === 'function') {
                        lottiePlayer.seek(0);
                    }
                    if (typeof lottiePlayer.play === 'function') {
                        lottiePlayer.play();
                    }
                }
                successModal.style.display = 'flex';
                setTimeout(() => {
                    successModal.classList.add('active');
                }, 10);
                
                let dismissed = false;
                const dismissModal = () => {
                    if (dismissed) return;
                    dismissed = true;
                    successModal.classList.remove('active');
                    setTimeout(() => {
                        successModal.style.display = 'none';
                        if (lottiePlayer && typeof lottiePlayer.stop === 'function') {
                            lottiePlayer.stop();
                        }
                    }, 300);
                };

                const autoDismissTimeout = setTimeout(dismissModal, 2200);

                successModal.onclick = () => {
                    clearTimeout(autoDismissTimeout);
                    dismissModal();
                };
            }

            // Refresh and sync across tabs and current tab
            await notifyDbUpdate('payments', payment.studentId);
        });
    }

    function applyViewerTransforms() {
        const img = document.getElementById('inspector-slip-img');
        img.style.transform = `scale(${state.zoomLevel}) rotate(${state.rotationAngle}deg)`;
    }


    // =========================================================================
    // MODAL: OFFICIAL E-RECEIPT
    // =========================================================================
    async function showReceiptModal(paymentId) {
        const payment = await window.tuitionStore.getPaymentById(paymentId);
        if (!payment) return;

        // Hide paper receipt and buttons, show slip image
        const paperReceipt = document.querySelector('.receipt-paper');
        if (paperReceipt) paperReceipt.style.display = 'none';
        
        const printBtn = document.getElementById('btn-receipt-print');
        if (printBtn && printBtn.parentElement) printBtn.parentElement.style.display = 'none';

        const slipViewer = document.getElementById('receipt-slip-viewer');
        const slipImg = document.getElementById('receipt-slip-img');
        if (slipViewer && slipImg) {
            slipViewer.style.display = 'block';
            slipImg.src = payment.slipImage || '';
            
            // Set up download button
            const downloadBtn = document.getElementById('btn-download-slip');
            if (downloadBtn) {
                downloadBtn.href = payment.slipImage || '#';
                downloadBtn.download = `slip_${payment.refNo || payment.id}.png`;
            }
        }

        // Open Receipt Modal
        const modal = document.getElementById('modal-receipt');
        modal.classList.add('active');

        // Modal close button
        document.getElementById('btn-close-receipt-modal').onclick = () => {
            modal.classList.remove('active');
        };
    }


});
