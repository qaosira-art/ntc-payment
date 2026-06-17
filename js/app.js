/**
 * Tuition Payment Portal - Main Application Logic
 * Integrates database persistence, slip conversion to PNG, drag-and-drop uploads,
 * automated slip generation, admin validation dashboard, and receipts.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Convert Lottie JSON data to a data URL to bypass local file CORS constraints
    function getLottieDogSrc() {
        if (typeof LOTTIE_DOG_JSON !== 'undefined') {
            try {
                return 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(LOTTIE_DOG_JSON));
            } catch (e) {
                console.error("Error stringifying LOTTIE_DOG_JSON:", e);
            }
        }
        return 'assets/dog.json'; // Fallback
    }

    // Helper functions for parsing funding information from name if column missing
    function getCleanName(fullName) {
        if (!fullName) return '';
        if (fullName.endsWith('(กยศ)')) {
            return fullName.slice(0, -6).trim();
        }
        if (fullName.endsWith('(จ่ายเอง)')) {
            return fullName.slice(0, -10).trim();
        }
        return fullName;
    }

    function getFundingText(student) {
        if (!student) return 'จ่ายเอง';
        if (student.funding) return student.funding;
        const name = student.name || '';
        if (name.endsWith('(กยศ)')) return 'กยศ';
        return 'จ่ายเอง';
    }

    // Current Application State
    const state = {
        currentStudent: null,
        selectedPaymentMode: 'full', // 'full' or 'custom'
        uploadedSlipBase64: null,
        uploadedSlipName: null,
        originalUploadedSlipBase64: null,
        customStudentInfo: null,
        
        // Stamp Header details
        stampName: '',
        stampId: '',
        
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

    // =========================================================================
    // CANVAS-LEVEL HEADERED SLIP IMAGE GENERATOR (PREMIUM TOP HEADER ZONE)
    // =========================================================================
    async function generateHeaderedSlip(originalBase64, stampName, stampId) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const W = img.naturalWidth;
                    const H = img.naturalHeight;
                    
                    const scale = W / 600;
                    const headerHeight = Math.round(110 * scale);
                    
                    canvas.width = W;
                    canvas.height = H + headerHeight;
                    
                    const ctx = canvas.getContext('2d');
                    
                    // 1. Draw header background
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, W, headerHeight);
                    
                    // 2. Draw subtle bottom divider line
                    ctx.strokeStyle = '#e5e5ea';
                    ctx.lineWidth = Math.max(1.5 * scale, 1);
                    ctx.beginPath();
                    ctx.moveTo(0, headerHeight - ctx.lineWidth/2);
                    ctx.lineTo(W, headerHeight - ctx.lineWidth/2);
                    ctx.stroke();
                    
                    // 3. Draw text details (Centered)
                    const fontSize = Math.max(22 * scale, 18);
                    
                    // First line: Class/ID/Room
                    ctx.fillStyle = '#86868b'; // Apple gray
                    ctx.font = `600 ${fontSize * 0.8}px 'Noto Sans Thai', sans-serif`;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    const mName = ctx.measureText(stampName);
                    ctx.fillText(stampName, W / 2 - mName.width / 2, headerHeight * 0.35);
                    
                    // Second line: Name
                    ctx.fillStyle = '#1d1d1f'; // Apple black
                    ctx.font = `bold ${fontSize}px 'Noto Sans Thai', sans-serif`;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    const mId = ctx.measureText(stampId);
                    ctx.fillText(stampId, W / 2 - mId.width / 2, headerHeight * 0.7);
                    
                    // 4. Draw original slip below header
                    ctx.drawImage(img, 0, headerHeight);
                    
                    resolve(canvas.toDataURL('image/png'));
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = (err) => reject(new Error("ไม่สามารถโหลดและประมวลผลรูปภาพดั้งเดิมได้"));
            img.src = originalBase64;
        });
    }

    function setupModalScrollObserver() {
        const checkScrollLock = () => {
            const modals = document.querySelectorAll('.premium-modal, .modal-backdrop, .slip-inspector-panel');
            const anyActive = Array.from(modals).some(m => {
                return m.classList.contains('active') || m.style.display === 'flex' || m.style.display === 'block';
            });
            if (anyActive) {
                document.documentElement.classList.add('no-scroll');
                document.body.classList.add('no-scroll');
            } else {
                document.documentElement.classList.remove('no-scroll');
                document.body.classList.remove('no-scroll');
            }
        };

        const observer = new MutationObserver((mutations) => {
            checkScrollLock();
        });

        const modals = document.querySelectorAll('.premium-modal, .modal-backdrop, .slip-inspector-panel');
        modals.forEach(m => {
            observer.observe(m, {
                attributes: true,
                attributeFilter: ['class', 'style']
            });
        });

        // Run once initially
        checkScrollLock();
    }

    async function initApp() {
        try {
            // 1. Initialize DB Store
            await window.tuitionStore.init();
            
            // 2. Setup Navigation
            setupNavigation();
            
            // 3. Setup Student Auth & Profiles
            renderStudentMockGrid();
            setupStudentAuth();
            setupPinModal();
            setupStudentGridSearch();
            
            // 4. Setup Student Payment Panel
            setupStudentPayment();
            
            // 5. Setup Admin Panel
            setupAdminPanel();
            
            // 6. Setup Slip Inspector Controls
            setupSlipInspector();

            // 7. Setup Avatar Upload
            setupAvatarUpload();

            // 7.5 Setup Slips Gallery
            setupStudentSlipsGallery();

            // 7.6 Setup Modal Scroll Observer
            setupModalScrollObserver();

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
        const hamburger = document.getElementById('btn-hamburger');
        const mobileDropdown = document.getElementById('mobile-nav-dropdown');

        function closeMobileMenu() {
            if (mobileDropdown) mobileDropdown.classList.remove('open');
            if (hamburger) hamburger.classList.remove('open');
        }

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
                
                if (targetViewId === 'view-student-album') {
                    renderStudentAlbum();
                }
                
                // Normal view switch
                switchView(targetViewId);
            });
        });

        // Hamburger toggle
        if (hamburger && mobileDropdown) {
            hamburger.addEventListener('click', e => {
                e.stopPropagation();
                hamburger.classList.toggle('open');
                mobileDropdown.classList.toggle('open');
            });
            document.addEventListener('click', e => {
                if (!mobileDropdown.contains(e.target) && e.target !== hamburger) {
                    closeMobileMenu();
                }
            });
        }

        // Mobile nav items
        function handleMobileNav(targetView, mobId) {
            closeMobileMenu();
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.mobile-nav-item').forEach(m => m.classList.remove('active'));
            const mobItem = document.getElementById(mobId);
            if (mobItem) mobItem.classList.add('active');
            
            if (targetView === 'view-student-auth') {
                const tabStudent = document.getElementById('tab-student-portal');
                if (tabStudent) tabStudent.classList.add('active');
                if (state.currentStudent) {
                    switchView('view-student-portal');
                    refreshStudentDashboard();
                    return;
                }
            } else if (targetView === 'view-admin-auth') {
                const tabAdmin = document.getElementById('tab-admin-portal');
                if (tabAdmin) tabAdmin.classList.add('active');
                if (sessionStorage.getItem('adminLoggedIn') === 'true') {
                    switchView('view-admin-portal');
                    updateAdminDashboard();
                    return;
                }
            } else if (targetView === 'view-image-tool') {
                const tabImage = document.getElementById('tab-image-tool');
                if (tabImage) tabImage.classList.add('active');
            } else if (targetView === 'view-student-album') {
                const tabAlbum = document.getElementById('tab-album');
                if (tabAlbum) tabAlbum.classList.add('active');
                renderStudentAlbum();
            }
            switchView(targetView);
        }

        const mobTabStudent = document.getElementById('mob-tab-student');
        const mobTabAdmin = document.getElementById('mob-tab-admin');
        const mobTabImageTool = document.getElementById('mob-tab-image-tool');
        const mobTabAlbum = document.getElementById('mob-tab-album');
        if (mobTabStudent) {
            mobTabStudent.addEventListener('click', () => handleMobileNav('view-student-auth', 'mob-tab-student'));
        }
        if (mobTabAdmin) {
            mobTabAdmin.addEventListener('click', () => handleMobileNav('view-admin-auth', 'mob-tab-admin'));
        }
        if (mobTabImageTool) {
            mobTabImageTool.addEventListener('click', () => handleMobileNav('view-image-tool', 'mob-tab-image-tool'));
        }
        if (mobTabAlbum) {
            mobTabAlbum.addEventListener('click', () => handleMobileNav('view-student-album', 'mob-tab-album'));
        }

        // Logo click goes home / student auth or logs out student if logged in (acting as back button)
        document.getElementById('btn-logo-home').addEventListener('click', (e) => {
            e.preventDefault();
            closeMobileMenu();
            if (state.currentStudent) {
                state.currentStudent = null;
                sessionStorage.removeItem('currentStudentId');
                resetPaymentForm();
                if (state.timerInterval) clearInterval(state.timerInterval);
                toggleImageMenu(false);
                renderStudentMockGrid();
                switchView('view-student-auth');
            } else {
                const tabStudent = document.getElementById('tab-student-portal');
                if (tabStudent) tabStudent.click();
            }
        });
    }

    function switchView(viewId) {
        window.scrollTo(0, 0); // รีเซ็ตตำแหน่ง scroll ทันที
        const sections = document.querySelectorAll('.view-section');
        
        sections.forEach(sec => {
            if (sec.id === viewId) {
                sec.classList.remove('hidden');
                // บังคับรีเซ็ต animation และเล่น effect ใหม่
                sec.style.animation = 'none';
                void sec.offsetWidth; 
                // ใช้เอฟเฟคค่อยๆ โผล่และขยายขึ้นนิดนึง (เหมือนในแอป iPhone)
                sec.style.animation = 'fadeInScale 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';
            } else {
                sec.classList.add('hidden');
            }
        });

        // Show header logout button only in admin portal
        const logoutBtn = document.getElementById('btn-admin-logout');
        if (logoutBtn) {
            if (viewId === 'view-admin-portal') {
                logoutBtn.style.display = 'flex';
            } else {
                logoutBtn.style.display = 'none';
            }
        }

        if (viewId === 'view-image-tool' && typeof window.populateImageToolDefaults === 'function') {
            window.populateImageToolDefaults();
        }
    }

    // =========================================================================
    // STUDENT AUTHENTICATION & PROFILES
    // =========================================================================
    async function renderStudentMockGrid() {
        const grid = document.getElementById('mock-students-grid');
        // แสดงสถานะกำลังโหลดข้อมูล
        grid.innerHTML = '<div style="text-align: center; padding: 20px; color: #86868b; font-size: 14px;"><i class="fa-solid fa-circle-notch fa-spin"></i> กำลังโหลดข้อมูลจากระบบหลังบ้าน...</div>';
        
        let students = await window.tuitionStore.getStudents();
        grid.innerHTML = '';
        
        // Filter if search input has value
        const searchInput = document.getElementById('input-search-slip-student');
        if (searchInput && searchInput.value) {
            const query = searchInput.value.trim().toLowerCase();
            students = students.filter(s => {
                return (s.id && s.id.toLowerCase().includes(query)) ||
                       (s.name && s.name.toLowerCase().includes(query));
            });
        }
        
        if (students.length === 0) {
            grid.innerHTML = '<div style="text-align: center; padding: 20px; color: #86868b; font-size: 14px;">ไม่พบข้อมูลนักเรียนที่ค้นหา</div>';
            return;
        }

        students.forEach(student => {
            const card = document.createElement('div');
            card.className = 'premium-student-row-card';
            
            const fundingText = getFundingText(student);
            let statusText = '';
            let badgeClass = '';
            if (student.status === 'paid') {
                statusText = 'จ่ายครบแล้ว';
                badgeClass = 'badge-paid';
            } else {
                statusText = fundingText;
                badgeClass = fundingText === 'กยศ' ? 'badge-gys' : 'badge-self';
            }

            // Calculate paid percentage (หลอดแสดงผล)
            const progressPct = Math.min(100, Math.round((student.paidAmount / student.totalTuition) * 100));
            const displayId = student.id;
            const cleanName = getCleanName(student.name);

            card.innerHTML = `
                <div class="student-card-content">
                    <!-- Left Section: Profile Info -->
                    <div class="student-card-profile">
                        <div class="student-card-avatar">
                            <img src="${student.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=e2e8f0'}" alt="Avatar">
                        </div>
                        <div class="student-card-details">
                            <div class="student-card-name">${cleanName}</div>
                            <div class="student-card-meta">
                                <span class="student-card-tag-id">ID: ${displayId}</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Center Section: Progress Bar (หลอดแสดงผลชำระเงิน) -->
                    <div class="student-card-progress-section">
                        <div class="student-card-progress-header">
                            <span class="student-card-status-label">สถานะ <span class="status-badge ${badgeClass}" style="padding: 2px 8px; font-size: 10.5px; vertical-align: middle;">${statusText}</span></span>
                            <span class="student-card-amount-label">${student.paidAmount.toLocaleString()} / ${student.totalTuition.toLocaleString()} บ.</span>
                        </div>
                        <!-- Progress Bar (หลอดแสดง) -->
                        <div class="student-card-progress-bar-bg">
                            <div class="student-card-progress-bar-fill ${student.status === 'paid' ? 'progress-rainbow' : ''}" style="width: ${progressPct}%;"></div>
                        </div>
                    </div>
                </div>
            `;
            
            // Open PIN modal instead of direct login
            card.addEventListener('click', () => {
                openStudentPinModal(student);
            });
            
            grid.appendChild(card);
        });
    }

    function setupStudentGridSearch() {
        const searchInput = document.getElementById('input-search-slip-student');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                renderStudentMockGrid();
            });
        }
    }

    // --- STUDENT PIN AUTHENTICATION LOGIC ---
    let pendingStudentLogin = null;

    let currentPin = '';

    function openStudentPinModal(student) {
        pendingStudentLogin = student;
        document.getElementById('pin-error').style.display = 'none';
        
        // Reset PIN
        currentPin = '';
        updatePinDisplay();
        
        // Force a layout recalculation to prevent Safari first-render glitch
        const modal = document.getElementById('modal-student-pin');
        void modal.offsetWidth;
        
        // Now trigger the CSS animation
        modal.classList.add('active');
    }

    const btnClosePin = document.getElementById('btn-close-pin');
    if (btnClosePin) {
        btnClosePin.addEventListener('click', () => {
            document.getElementById('modal-student-pin').classList.remove('active');
            pendingStudentLogin = null;
        });
    }

    function updatePinDisplay() {
        const pinDisplays = [
            document.getElementById('pin1-display'),
            document.getElementById('pin2-display'),
            document.getElementById('pin3-display'),
            document.getElementById('pin4-display')
        ];
        
        pinDisplays.forEach((disp, i) => {
            if (i < currentPin.length) {
                disp.textContent = currentPin[i];
                disp.classList.add('focused-box');
            } else {
                disp.textContent = '';
                disp.classList.remove('focused-box');
            }
            
            // Add a slight active state to the current box being typed into
            if (i === currentPin.length) {
                disp.style.borderColor = 'var(--primary)';
            } else {
                disp.style.borderColor = '';
            }
        });
    }

    function handleNumpadClick(val) {
        const errorText = document.getElementById('pin-error');
        errorText.style.display = 'none';
        
        if (currentPin.length < 4) {
            currentPin += val;
            updatePinDisplay();
            
            if (currentPin.length === 4) {
                verifyPin();
            }
        }
    }

    function handleNumpadDelete() {
        if (currentPin.length > 0) {
            currentPin = currentPin.slice(0, -1);
            updatePinDisplay();
            document.getElementById('pin-error').style.display = 'none';
        }
    }

    function setupPinModal() {
        const modal = document.getElementById('modal-student-pin');
        if (!modal) return;

        // Close modal when clicking outside the content (on the modal container itself)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                pendingStudentLogin = null;
            }
        });

        // Setup custom numpad with instant touch response
        const numpadBtns = document.querySelectorAll('.numpad-btn[data-val]');
        numpadBtns.forEach(btn => {
            btn.addEventListener('pointerdown', (e) => {
                btn.classList.add('active-tap');
                handleNumpadClick(btn.getAttribute('data-val'));
            });
            btn.addEventListener('pointerup', () => btn.classList.remove('active-tap'));
            btn.addEventListener('pointercancel', () => btn.classList.remove('active-tap'));
            btn.addEventListener('pointerleave', () => btn.classList.remove('active-tap'));
        });

        // Setup hardware keyboard support
        document.addEventListener('keydown', (e) => {
            if (!modal.classList.contains('active')) return;
            
            if (/^[0-9]$/.test(e.key)) {
                e.preventDefault();
                handleNumpadClick(e.key);
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                handleNumpadDelete();
            }
        });

        const numpadDeleteBtn = document.getElementById('numpad-delete-btn');
        if (numpadDeleteBtn) {
            numpadDeleteBtn.addEventListener('pointerdown', (e) => {
                numpadDeleteBtn.classList.add('active-tap');
                handleNumpadDelete();
            });
            numpadDeleteBtn.addEventListener('pointerup', () => numpadDeleteBtn.classList.remove('active-tap'));
            numpadDeleteBtn.addEventListener('pointercancel', () => numpadDeleteBtn.classList.remove('active-tap'));
            numpadDeleteBtn.addEventListener('pointerleave', () => numpadDeleteBtn.classList.remove('active-tap'));
        }
    }

    function verifyPin() {
        if (!pendingStudentLogin) return;
        
        const targetPin = pendingStudentLogin.id.slice(-4);
        
        if (currentPin === targetPin) {
            const modal = document.getElementById('modal-student-pin');
            modal.classList.remove('active');
            logInStudent(pendingStudentLogin);
            pendingStudentLogin = null;
        } else {
            // Wrong PIN
            const errorText = document.getElementById('pin-error');
            errorText.style.display = 'block';
            
            // Add a small shake animation to pin inputs container
            const modal = document.getElementById('modal-student-pin');
            const content = modal.querySelector('.pin-inputs');
            if (content) {
                content.style.animation = 'shake 0.4s cubic-bezier(.36,.07,.19,.97) both';
                setTimeout(() => { content.style.animation = ''; }, 400);
            }
            
            // Clear input
            currentPin = '';
            updatePinDisplay();
        }
    }


    // Handle avatar image upload with interactive crop and position adjustments
    function setupAvatarUpload() {
        const uploadInput = document.getElementById('avatar-upload');
        const avatarImg = document.getElementById('student-display-avatar');
        const cropModal = document.getElementById('modal-crop-profile');
        const cropImg = document.getElementById('crop-preview-img');
        const btnCancelCrop = document.getElementById('btn-cancel-crop');
        const btnSaveCrop = document.getElementById('btn-save-crop');
        
        if (!uploadInput || !avatarImg || !cropModal || !cropImg || !btnCancelCrop || !btnSaveCrop) return;

        let imgW = 0;
        let imgH = 0;
        let fitW = 0;
        let fitH = 0;
        let currentX = 0;
        let currentY = 0;
        let currentZoom = 1;
        
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialX = 0;
        let initialY = 0;

        uploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (evt) => {
                cropImg.src = evt.target.result;
                cropModal.classList.add('active');
            };
            reader.readAsDataURL(file);
        });

        cropImg.onload = () => {
            imgW = cropImg.naturalWidth;
            imgH = cropImg.naturalHeight;
            
            const viewportSize = 280;
            // Fit aspect ratio: Shorter side must equal viewportSize (280)
            if (imgW > imgH) {
                const scale = viewportSize / imgH;
                fitH = viewportSize;
                fitW = imgW * scale;
            } else {
                const scale = viewportSize / imgW;
                fitW = viewportSize;
                fitH = imgH * scale;
            }

            cropImg.style.width = `${fitW}px`;
            cropImg.style.height = `${fitH}px`;
            
            // Center the image initially
            currentX = (viewportSize - fitW) / 2;
            currentY = (viewportSize - fitH) / 2;
            currentZoom = 1;
            
            updatePreviewTransform();
        };

        function updatePreviewTransform() {
            cropImg.style.transform = `translate(${currentX}px, ${currentY}px) scale(${currentZoom})`;
        }

        // Drag events
        const startDrag = (clientX, clientY) => {
            isDragging = true;
            startX = clientX;
            startY = clientY;
            initialX = currentX;
            initialY = currentY;
        };

        const moveDrag = (clientX, clientY) => {
            if (!isDragging) return;
            const dx = clientX - startX;
            const dy = clientY - startY;
            currentX = initialX + dx;
            currentY = initialY + dy;
            updatePreviewTransform();
        };

        const stopDrag = () => {
            isDragging = false;
        };

        // Mouse listeners
        cropImg.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startDrag(e.clientX, e.clientY);
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging) moveDrag(e.clientX, e.clientY);
        });

        window.addEventListener('mouseup', stopDrag);

        // Touch listeners & Pinch to Zoom
        let initialPinchDist = 0;
        let initialPinchZoom = 1;

        cropImg.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                startDrag(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                isDragging = false;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initialPinchDist = Math.sqrt(dx*dx + dy*dy);
                initialPinchZoom = currentZoom;
            }
        }, {passive: false});

        cropModal.addEventListener('touchmove', (e) => {
            if (isDragging && e.touches.length === 1) {
                e.preventDefault();
                moveDrag(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                const oldZoom = currentZoom;
                currentZoom = initialPinchZoom * (dist / initialPinchDist);
                
                if (currentZoom < 0.2) currentZoom = 0.2;
                if (currentZoom > 10) currentZoom = 10;
                
                // Zoom around center
                const cx = 140;
                const cy = 140;
                
                const imgX = (cx - currentX) / oldZoom;
                const imgY = (cy - currentY) / oldZoom;
                
                currentX = cx - imgX * currentZoom;
                currentY = cy - imgY * currentZoom;
                
                updatePreviewTransform();
            }
        }, { passive: false });

        window.addEventListener('touchend', stopDrag);

        // Mouse wheel to zoom
        cropImg.parentElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            const oldZoom = currentZoom;
            if (e.deltaY < 0) {
                currentZoom *= 1.1;
            } else {
                currentZoom /= 1.1;
            }
            if (currentZoom < 0.2) currentZoom = 0.2;
            if (currentZoom > 10) currentZoom = 10;

            const rect = cropImg.parentElement.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            
            const imgX = (cx - currentX) / oldZoom;
            const imgY = (cy - currentY) / oldZoom;
            
            currentX = cx - imgX * currentZoom;
            currentY = cy - imgY * currentZoom;
            
            updatePreviewTransform();
        });

        // Cancel crop
        btnCancelCrop.addEventListener('click', () => {
            cropModal.classList.remove('active');
            uploadInput.value = ''; // Clear selected file
        });

        // Save crop
        btnSaveCrop.addEventListener('click', async () => {
            try {
                // Pre-check dimension validity
                const validW = fitW || cropImg.naturalWidth || 280;
                const validH = fitH || cropImg.naturalHeight || 280;
                const validZoom = currentZoom || 1;
                const validX = currentX || 0;
                const validY = currentY || 0;

                // Draw to a 300x300 canvas for high-quality profile
                const canvas = document.createElement('canvas');
                canvas.width = 300;
                canvas.height = 300;
                const ctx = canvas.getContext('2d');
                
                const viewportSize = 280;
                const scaleFactor = 300 / viewportSize;
                
                const drawW = validW * validZoom * scaleFactor;
                const drawH = validH * validZoom * scaleFactor;
                const drawX = validX * scaleFactor;
                const drawY = validY * scaleFactor;

                // Validate coordinates are finite numbers
                if (isFinite(drawX) && isFinite(drawY) && isFinite(drawW) && isFinite(drawH) && drawW > 0 && drawH > 0) {
                    // Enable image smoothing for high-quality scale
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    
                    ctx.drawImage(cropImg, drawX, drawY, drawW, drawH);
                } else {
                    console.warn("Invalid crop bounds. Drawing original image full scale...");
                    ctx.drawImage(cropImg, 0, 0, 300, 300);
                }
                
                // Generate JPEG base64 string
                const base64Str = canvas.toDataURL('image/jpeg', 0.6);
                
                // Set student avatar image elements on page
                avatarImg.src = base64Str;
                
                // Save to store & db
                if (state.currentStudent) {
                    state.currentStudent.avatar = base64Str;
                    
                    // Always save local override to ensure instant display on landing page grid
                    localStorage.setItem(`tuition_avatar_${state.currentStudent.id}`, base64Str);
                    
                    try {
                        await window.tuitionStore.updateStudent(state.currentStudent);
                    } catch (dbErr) {
                        console.error("Failed to update student avatar in DB:", dbErr);
                        alert("อัปโหลดลงฐานข้อมูลไม่สำเร็จ: " + (dbErr.message || JSON.stringify(dbErr)));
                    }
                    await notifyDbUpdate('students', state.currentStudent.id);
                }
            } catch (err) {
                console.error("Failed to crop and save avatar:", err);
                alert("เกิดข้อผิดพลาดขณะตัดภาพโปรไฟล์: " + err.message);
            } finally {
                cropModal.classList.remove('active');
                uploadInput.value = ''; // Reset file input
            }
        });
    }

    // Bind event listeners for student slips gallery modal
    function setupStudentSlipsGallery() {
        const btnViewAll = document.getElementById('btn-view-all-slips');
        const modal = document.getElementById('modal-student-slips');
        const btnClose = document.getElementById('btn-close-student-slips-modal');
        const slipsGrid = document.getElementById('student-slips-grid');
        const emptyState = document.getElementById('student-slips-empty-state');

        if (!btnViewAll || !modal || !btnClose) return;

        btnViewAll.addEventListener('click', async () => {
            if (!state.currentStudent) return;
            
            // Clear grid
            slipsGrid.innerHTML = '';
            
            // Fetch payments
            const payments = await window.tuitionStore.getPaymentsByStudentId(state.currentStudent.id);
            const slipPayments = payments.filter(p => p.slipImage && p.status !== 'card');

            if (slipPayments.length === 0) {
                emptyState.style.display = 'block';
                slipsGrid.style.display = 'none';
            } else {
                emptyState.style.display = 'none';
                slipsGrid.style.display = 'grid';

                slipPayments.forEach(payment => {
                    const card = document.createElement('div');
                    card.className = 'slip-gallery-card';
                    card.style.background = 'var(--neutral-light)';
                    card.style.borderRadius = '12px';
                    card.style.padding = '12px';
                    card.style.display = 'flex';
                    card.style.flexDirection = 'column';
                    card.style.gap = '8px';
                    card.style.border = '1px solid var(--neutral-border)';
                    card.style.cursor = 'pointer';

                    let statusText = '';
                    let statusClass = '';
                    if (payment.status === 'approved') {
                        statusText = 'อนุมัติแล้ว';
                        statusClass = 'badge-paid';
                    } else if (payment.status === 'rejected') {
                        statusText = 'ปฏิเสธ';
                        statusClass = 'badge-rejected';
                    } else {
                        statusText = 'ตรวจสอบอยู่';
                        statusClass = 'badge-pending';
                    }

                    const formattedDate = new Date(payment.dateTime).toLocaleString('th-TH', {
                        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
                    }).replace(':', '.');

                    card.innerHTML = `
                        <div style="width: 100%; height: 200px; border-radius: 8px; overflow: hidden; background: #fff; position: relative;">
                            <img src="${payment.slipImage}" style="width: 100%; height: 100%; object-fit: contain; display: block;" alt="สลิป">
                            <div style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.6); color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px;">
                                <i class="fa-solid fa-expand"></i>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                            <span style="font-size: 13px; font-weight: 700; color: var(--neutral-dark);">${payment.amount > 0 ? payment.amount.toLocaleString() + ' THB' : '<span style="font-size:11px; color:#86868b; font-weight:500;">(ไม่ระบุยอด)</span>'}</span>
                            <span class="status-badge ${statusClass}" style="font-size: 10px; padding: 3px 8px; scale: 0.95; transform-origin: right;">${statusText}</span>
                        </div>
                        <div style="font-size: 11px; color: #86868b; font-weight: 500;">ส่งวันที่: ${formattedDate}</div>
                    `;

                    card.addEventListener('click', () => {
                        // Close this gallery modal
                        modal.classList.remove('active');
                        // Show the full-size receipt/slip viewer
                        showReceiptModal(payment.id, true);
                    });

                    slipsGrid.appendChild(card);
                });
            }

            modal.classList.add('active');
        });

        btnClose.addEventListener('click', () => {
            modal.classList.remove('active');
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
        const logoutBtn = document.getElementById('btn-student-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                state.currentStudent = null;
                sessionStorage.removeItem('currentStudentId');
                
                // Clear payment form inputs and previews
                resetPaymentForm();
                
                // Clear interval
                if (state.timerInterval) clearInterval(state.timerInterval);

                toggleImageMenu(false);

                // Re-render mock profile status list and switch view
                renderStudentMockGrid();
                switchView('view-student-auth');
            });
        }
    }

    function toggleImageMenu(show) {
        const desktopTab = document.getElementById('tab-image-tool');
        const mobileDivider = document.getElementById('mob-tab-image-divider');
        const mobileTab = document.getElementById('mob-tab-image-tool');
        
        if (show) {
            if (desktopTab) desktopTab.style.display = '';
            if (mobileDivider) mobileDivider.style.display = '';
            if (mobileTab) mobileTab.style.display = '';
        } else {
            if (desktopTab) desktopTab.style.display = 'none';
            if (mobileDivider) mobileDivider.style.display = 'none';
            if (mobileTab) mobileTab.style.display = 'none';
        }
    }

    async function logInStudent(student) {
        state.currentStudent = student;
        sessionStorage.setItem('currentStudentId', student.id);
        
        const cleanName = getCleanName(student.name);
        const fundingText = getFundingText(student);

        // Initialize stamp details for Header Zone
        const last4 = student.id.replace(/\D/g, '').slice(-4) || student.id.slice(-4);
        let genText = student.generation || student.year || '-';
        if (genText !== '-' && !genText.startsWith('รุ่น')) genText = 'รุ่น ' + genText;
        state.stampName = `${genText} รหัส ${last4} ห้อง ${student.room || '-'}`;
        state.stampId = cleanName;
        
        // Set header active state
        document.querySelectorAll('.app-header .nav-tab').forEach(t => t.classList.remove('active'));
        document.getElementById('tab-student-portal').classList.add('active');
        
        // Show Image Menu
        toggleImageMenu(true);

        // Update Student View Info
        document.getElementById('student-display-name').textContent = cleanName;
        document.getElementById('student-display-meta').textContent = `รหัส: ${student.id} • ห้อง ${student.room} • ${fundingText}`;
        
        const avatarImg = document.getElementById('student-display-avatar');
        if (avatarImg) {
            avatarImg.src = student.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=e2e8f0';
        }
        
        // Update Theme
        const themeBanner = document.getElementById('student-hero-banner');
        if (themeBanner) {
            const savedTheme = localStorage.getItem('student_theme_' + student.id) || student.theme || 'theme-default';
            student.theme = savedTheme;
            themeBanner.className = 'student-hero-banner ' + savedTheme;
        }
        
        
        // Show Portal View IMMEDIATELY so it feels snappy
        switchView('view-student-portal');
        
        // Start simulated Countdown timer
        startQRCountdown();

        // Refresh dashboard details (fetches payments, etc)
        await refreshStudentDashboard();
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
        if (badge) {
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

        const payments = (await window.tuitionStore.getPaymentsByStudentId(state.currentStudent.id, true))
            .filter(p => p.status !== 'card');
        
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
                        <div class="timeline-meta">ส่งวันที่: ${formattedDate}</div>
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
            const cleanName = getCleanName(state.currentStudent.name);
            stdNameField.value = cleanName + " รุ่น21";
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
 
                // Pre-fill from state variables
                document.getElementById('stamp-slip-name').value = state.stampName;
                document.getElementById('stamp-slip-id').value = state.stampId;
                document.getElementById('stamp-slip-phone').value = state.currentStudent.phone || '081-132-2816';
 
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
            formStampSlip.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const nameVal = document.getElementById('stamp-slip-name').value.trim();
                const idVal = document.getElementById('stamp-slip-id').value.trim();
                const phoneVal = document.getElementById('stamp-slip-phone').value.trim();
 
                if (!nameVal || !idVal || !phoneVal) {
                    alert("❌ กรุณากรอกข้อมูลให้ครบทุกช่อง");
                    return;
                }
 
                // Update state variables
                state.stampName = nameVal;
                state.stampId = idVal;
 
                // Re-generate headered slip using original uploaded clean slip!
                if (state.originalUploadedSlipBase64) {
                    try {
                        const processedBase64 = await generateHeaderedSlip(state.originalUploadedSlipBase64, state.stampName, state.stampId);
                        state.uploadedSlipBase64 = processedBase64;
                        document.getElementById('slip-preview-img').src = processedBase64;
                    } catch (err) {
                        console.error("Error regenerating headered slip:", err);
                        alert("❌ เกิดข้อผิดพลาดในการสร้างภาพสลิปใหม่");
                    }
                }
 
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
 
            state.originalUploadedSlipBase64 = base64Png; // Store clean original mockup slip backup
            state.uploadedSlipName = `slip_${state.currentStudent.id}_custom.png`;
 
            // Reset stamp info to default context (in case they edited it earlier)
            const last4 = state.currentStudent.id.replace(/\D/g, '').slice(-4) || state.currentStudent.id.slice(-4);
            let genText = state.currentStudent.generation || state.currentStudent.year || '-';
            if (genText !== '-' && !genText.startsWith('รุ่น')) genText = 'รุ่น ' + genText;
            state.stampName = `${genText} รหัส ${last4} ห้อง ${state.currentStudent.room || '-'}`;
            state.stampId = state.currentStudent.name;
 
            // Generate the headered slip
            generateHeaderedSlip(base64Png, state.stampName, state.stampId).then(processedBase64 => {
                state.uploadedSlipBase64 = processedBase64;
 
                // Display in Preview
                const previewContainer = document.getElementById('slip-preview-container');
                const previewImg = document.getElementById('slip-preview-img');
                previewImg.src = processedBase64;
                previewContainer.style.display = 'block';
 
                // Auto-populate the main input payment amount matching mock slip
                const mainPayInput = document.getElementById('input-pay-amount');
                if (mainPayInput) {
                    mainPayInput.value = amount;
                    mainPayInput.dispatchEvent(new Event('input'));
                }
 
                // Clear error if present
                document.getElementById('slip-error').style.display = 'none';
 
                // Close Modal
                closeEditSlipModal();
 
                // Notify user of success
                alert("🎉 สร้างและแนบภาพสลิปจำลองที่แก้ไขเรียบร้อยแล้ว!");
            }).catch(err => {
                console.error("Error generating headered mock slip:", err);
                alert("❌ เกิดข้อผิดพลาดในการสร้างหัวกระดาษสลิปจำลอง");
            });
        });


        // FORM SUBMIT PAYMENT EVIDENCE
        document.getElementById('form-tuition-payment').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = document.getElementById('btn-submit-payment');
            if (submitBtn.disabled) return; // Prevent double click
            
            const origHtml = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'กำลังส่งข้อมูล... <i class="fa-solid fa-spinner fa-spin" style="margin-left: 6px;"></i>';
            submitBtn.style.opacity = '0.7';
            
            try {
                // Validate inputs
                const payAmount = getFinalPayAmount();
                const remaining = state.currentStudent.totalTuition - state.currentStudent.paidAmount;
                
                if (payAmount <= 0) {
                    alert("❌ กรุณาระบุจำนวนเงินที่ต้องการชำระ");
                    const inputEl = document.getElementById('input-pay-amount');
                    inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    inputEl.focus();
                    document.getElementById('custom-amount-error').style.display = 'block';
                    return;
                }
                
                if (payAmount > remaining) {
                    alert(`❌ จำนวนเงินที่ระบุ (${payAmount.toLocaleString()} บาท) เกินกว่ายอดที่ค้างชำระ (${remaining.toLocaleString()} บาท)`);
                    const inputEl = document.getElementById('input-pay-amount');
                    inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    inputEl.focus();
                    document.getElementById('custom-amount-error').style.display = 'block';
                    return;
                }
                
                if (!state.uploadedSlipBase64) {
                    alert("❌ กรุณาแนบไฟล์ภาพสลิปชำระเงินก่อนส่งข้อมูล");
                    const dropzoneEl = document.getElementById('slip-dropzone');
                    dropzoneEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    document.getElementById('slip-error').style.display = 'block';
                    return;
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
                    verificationDate: null,
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
            } catch (err) {
                console.error("Payment submission error:", err);
                alert(`❌ เกิดข้อผิดพลาดในการส่งสลิป: ${err.message || err.description || JSON.stringify(err)}`);
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = origHtml;
                submitBtn.style.opacity = '1';
            }
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
img.onload = async () => {
    // Render original image to a canvas and export as PNG
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pngDataUrl = canvas.toDataURL('image/png');

    // Store the clean original for potential re‑stamp later
    state.originalUploadedSlipBase64 = pngDataUrl;

    // Generate the premium headered slip using the current student's stamp info
    try {
        const processedBase64 = await generateHeaderedSlip(pngDataUrl, state.stampName, state.stampId);
        state.uploadedSlipBase64 = processedBase64;
        state.uploadedSlipName = `${file.name.substring(0, file.name.lastIndexOf('.')) || file.name}_converted.png`;

        // Update preview UI
        const previewImg = document.getElementById('slip-preview-img');
        previewImg.src = processedBase64;
        document.getElementById('slip-preview-container').style.display = 'block';

        // Hide the old interactive badge (no longer needed)
        const badge = document.getElementById('slip-interactive-badge');
        if (badge) badge.style.display = 'none';
    } catch (err) {
        console.error('Error generating headered slip:', err);
        alert('❌ เกิดข้อผิดพลาดในการสร้างหัวกระดาษสลิป');
    }
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

            if (password === 'pp1234') { // Exact Admin password
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
        const tabCards = document.getElementById('btn-admin-tab-cards');
        const contentVault = document.getElementById('admin-tab-vault');
        const contentStudents = document.getElementById('admin-tab-students');
        const contentCards = document.getElementById('admin-tab-cards');

        function selectAdminTab(tabName) {
            state.activeAdminTab = tabName;
            
            // Buttons active state
            tabVault.classList.toggle('active', tabName === 'vault');
            tabStudents.classList.toggle('active', tabName === 'students');
            if (tabCards) tabCards.classList.toggle('active', tabName === 'cards');
            
            // Panels display state
            contentVault.style.display = tabName === 'vault' ? 'block' : 'none';
            contentStudents.style.display = tabName === 'students' ? 'block' : 'none';
            if (contentCards) contentCards.style.display = tabName === 'cards' ? 'block' : 'none';
            
            updateAdminDashboard();
        }

        tabVault.addEventListener('click', () => {
            if (state.activeAdminTab === 'vault') return;
            selectAdminTab('vault');
        });

        tabStudents.addEventListener('click', () => {
            if (state.activeAdminTab === 'students') return;
            selectAdminTab('students');
        });

        if (tabCards) {
            tabCards.addEventListener('click', () => {
                if (state.activeAdminTab === 'cards') return;
                selectAdminTab('cards');
            });
        }

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
                year: document.getElementById('add-student-generation').value.trim(),
                room: document.getElementById('add-student-room').value.trim(),
                totalTuition: parseFloat(document.getElementById('add-student-tuition').value) || 60000,
                paidAmount: 0,
                status: 'unpaid',
                funding: document.getElementById('add-student-funding').value
            };

            // Check if student id duplicate
            try {
                const exist = await window.tuitionStore.getStudentById(student.id);
                if (exist) {
                    alert(`❌ รหัสนักเรียน ${student.id} มีในฐานข้อมูลอยู่แล้ว!`);
                    return;
                }

                await window.tuitionStore.addStudent(student);
                
                // Success
                alert(`🎉 เพิ่มข้อมูลนักเรียน ${student.name} สำเร็จ!`);
                document.getElementById('form-admin-add-student').reset();
                document.getElementById('add-student-funding').value = 'จ่ายเอง';
                document.getElementById('modal-add-student').classList.remove('active');
                
                // Refresh and sync across tabs and current tab
                await notifyDbUpdate('students', student.id);
            } catch (err) {
                console.error("Error adding student:", err);
                alert(`❌ เกิดข้อผิดพลาดในการบันทึกข้อมูล: ${err.message || err.description || JSON.stringify(err)}`);
            }
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
                try {
                    // Delete all payments associated with student from Supabase first
                    await window.tuitionStore.deletePaymentsByStudentId(stdId);
                    
                    // Delete student from Supabase
                    await window.tuitionStore.deleteStudent(stdId);
                    
                    alert("🗑️ ลบข้อมูลนักเรียนเรียบร้อยแล้ว");
                    document.getElementById('modal-edit-student').classList.remove('active');
                    await notifyDbUpdate('students', stdId);
                } catch (err) {
                    console.error("Error deleting student:", err);
                    alert(`❌ เกิดข้อผิดพลาดในการลบข้อมูล: ${err.message || JSON.stringify(err)}`);
                }
            }
        });

        // Edit Student Form submit
        document.getElementById('form-admin-edit-student').addEventListener('submit', async (e) => {
            e.preventDefault();

            const oldId = document.getElementById('edit-student-old-id').value.trim();
            const newId = document.getElementById('edit-student-id').value.trim().toUpperCase();
            
            try {
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

                // Delete generation property if it exists to prevent database error
                delete student.generation;
                
                student.year = document.getElementById('edit-student-generation').value.trim();
                student.id = newId;
                student.room = document.getElementById('edit-student-room').value.trim();
                student.name = document.getElementById('edit-student-name').value.trim();
                student.funding = document.getElementById('edit-student-funding').value;

                if (oldId !== newId) {
                    // Add new student record first
                    await window.tuitionStore.addStudent(student);
                    
                    // Update all payments to point to the new ID
                    const payments = await window.tuitionStore.getPaymentsByStudentId(oldId, true);
                    for (const p of payments) {
                        p.studentId = newId;
                        await window.tuitionStore.updatePayment(p);
                    }

                    // Finally delete the old student record
                    await window.tuitionStore.deleteStudent(oldId);
                } else {
                    await window.tuitionStore.updateStudent(student);
                }
                
                alert(`✅ แก้ไขข้อมูลนักเรียน ${student.name} สำเร็จ!`);
                document.getElementById('form-admin-edit-student').reset();
                document.getElementById('modal-edit-student').classList.remove('active');
                
                await notifyDbUpdate('students', student.id);
            } catch (err) {
                console.error("Error editing student:", err);
                alert(`❌ เกิดข้อผิดพลาดในการบันทึกข้อมูลการแก้ไข: ${err.message || err.description || JSON.stringify(err)}`);
            }
        });

        // Search Student input
        document.getElementById('input-search-student').addEventListener('input', () => {
            renderAdminStudentsList();
        });
    }

    async function updateAdminDashboard() {
        const [students, payments] = await Promise.all([
            window.tuitionStore.getStudents(),
            window.tuitionStore.getPayments(true)
        ]);

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
        } else if (state.activeAdminTab === 'cards') {
            await renderAdminCardsList();
        } else {
            await renderAdminStudentsList();
        }

        // 3. Keep Student Auth Profiles synchronized
        await renderStudentMockGrid();
    }

    async function renderAdminVaultList() {
        const tbody = document.getElementById('admin-vault-table-body');
        const emptyState = document.getElementById('vault-empty-state');

        const payments = await window.tuitionStore.getPayments(true);
        
        // Show ONLY pending items and sort earliest first (FIFO)
        const filtered = payments
            .filter(p => p.status === 'pending')
            .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
            tbody.closest('table').style.display = 'none';
            return;
        } else {
            emptyState.style.display = 'none';
            tbody.closest('table').style.display = 'table';
        }

        const studentsList = await window.tuitionStore.getStudents();
        const studentMap = {};
        studentsList.forEach(s => {
            studentMap[s.id] = s;
        });

        const fragment = document.createDocumentFragment();

        for (const payment of filtered) {
            const student = studentMap[payment.studentId];
            const stdName = student ? student.name : 'Unknown';
            const cleanStdName = getCleanName(stdName);
            const fundingText = getFundingText(student);

            const row = document.createElement('tr');
            
            let badgeClass = '';
            let statusText = '';
            let actionBtn = '';

            if (payment.status === 'approved') {
                statusText = 'อนุมัติแล้ว';
                badgeClass = 'badge-paid';
                actionBtn = `<button class="btn-modern btn-modern-secondary btn-modern-sm btn-admin-view-slip" data-payment-id="${payment.id}"><i class="fa-solid fa-eye"></i> <span class="hide-text-mobile">ดูใบสลิป PNG</span></button>`;
            } else if (payment.status === 'rejected') {
                statusText = 'ปฏิเสธหลักฐาน';
                badgeClass = 'badge-rejected';
                actionBtn = `<button class="btn-modern btn-modern-secondary btn-modern-sm btn-admin-view-slip" data-payment-id="${payment.id}"><i class="fa-solid fa-eye"></i> <span class="hide-text-mobile">ดูภาพความขัดแย้ง</span></button>`;
            } else {
                statusText = 'รอดำเนินการ';
                badgeClass = 'badge-pending';
                actionBtn = `<button class="btn-modern btn-modern-primary btn-modern-sm btn-admin-inspect" data-payment-id="${payment.id}"><i class="fa-solid fa-magnifying-glass"></i> <span class="hide-text-mobile">ตรวจสอบสลิป</span></button>`;
            }

            const formattedDate = new Date(payment.dateTime).toLocaleString('th-TH', {
                year: '2-digit', month: 'short', day: 'numeric'
            });

            row.innerHTML = `
                <td style="font-weight: 700;">
                    <div>${cleanStdName}</div>
                </td>
                <td style="font-weight: 800; color: var(--primary);">${payment.amount > 0 ? payment.amount.toLocaleString() + ' บ.' : '<span style="font-weight:500; font-size:12px; color:#86868b;">ไม่ระบุยอด</span>'}</td>
                <td>${formattedDate}</td>
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

        const countSpan = document.getElementById('admin-students-count');
        if (countSpan) {
            countSpan.textContent = `(${filtered.length})`;
        }

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

            const cleanName = getCleanName(s.name);
            const fundingText = getFundingText(s);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="text-align: center;">
                    <span class="status-badge ${fundingText === 'กยศ' ? 'badge-gys' : 'badge-self'}">${fundingText}</span>
                </td>
                <td style="text-align: center; font-weight: 600;">${s.year || '-'}</td>
                <td style="text-align: center; font-family: monospace; font-weight: 700;">${s.id}</td>
                <td style="text-align: center; font-weight: 500;">${s.room}</td>
                <td style="text-align: center; font-weight: 700;">
                    <div>${cleanName}</div>
                </td>
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
                    let fundingVal = student.funding;
                    let displayName = student.name || '';
                    if (!fundingVal) {
                        if (displayName.endsWith('(กยศ)')) {
                            fundingVal = 'กยศ';
                            displayName = displayName.slice(0, -6).trim();
                        } else if (displayName.endsWith('(จ่ายเอง)')) {
                            fundingVal = 'จ่ายเอง';
                            displayName = displayName.slice(0, -10).trim();
                        } else {
                            fundingVal = 'จ่ายเอง';
                        }
                    }
                    document.getElementById('edit-student-old-id').value = student.id;
                    document.getElementById('edit-student-generation').value = student.year || '';
                    document.getElementById('edit-student-id').value = student.id;
                    document.getElementById('edit-student-room').value = student.room || '';
                    document.getElementById('edit-student-name').value = displayName;
                    document.getElementById('edit-student-funding').value = fundingVal;
                    document.getElementById('modal-edit-student').classList.add('active');
                }
            });
        });
    }

    /**
     * Render the grid gallery of student introduction cards in the Admin Portal.
     */
    async function renderAdminCardsList() {
        const gallery = document.getElementById('admin-cards-gallery');
        const emptyState = document.getElementById('cards-empty-state');
        if (!gallery || !emptyState) return;

        try {
            const cards = await window.tuitionStore.getIntroCards();
            
            if (cards.length === 0) {
                emptyState.style.display = 'block';
                gallery.style.display = 'none';
                return;
            }

            const studentsList = await window.tuitionStore.getStudents();
            const studentMap = {};
            studentsList.forEach(s => {
                studentMap[s.id] = s;
            });

            emptyState.style.display = 'none';
            gallery.style.display = 'grid';

            // Precalculate chronological sequence numbers per student (oldest to newest)
            const cardSeqMap = {};
            const cardsWithId = cards.map(c => {
                let actualId = c.studentId;
                if (c.comment && c.comment.startsWith('CARD_INFO:')) {
                    try {
                        const info = JSON.parse(c.comment.substring(10));
                        actualId = info.id;
                    } catch (e) {}
                }
                return { c, actualId, time: c.dateTime ? new Date(c.dateTime).getTime() : 0 };
            });
            // Sort ascending by time
            cardsWithId.sort((a, b) => a.time - b.time);
            const studentCounts = {};
            cardsWithId.forEach(item => {
                const id = item.actualId;
                if (!studentCounts[id]) {
                    studentCounts[id] = 0;
                }
                studentCounts[id]++;
                cardSeqMap[item.c.id] = studentCounts[id];
            });

            // Group cards by student and sort chronologically within the group
            const earliestUploadMap = {};
            const cardToStudentIdMap = {};
            cardsWithId.forEach(item => {
                cardToStudentIdMap[item.c.id] = item.actualId;
                if (earliestUploadMap[item.actualId] === undefined) {
                    earliestUploadMap[item.actualId] = item.time;
                }
            });

            cards.sort((a, b) => {
                const sIdA = cardToStudentIdMap[a.id];
                const sIdB = cardToStudentIdMap[b.id];
                
                const earliestA = earliestUploadMap[sIdA] || 0;
                const earliestB = earliestUploadMap[sIdB] || 0;
                
                if (earliestA !== earliestB) {
                    return earliestA - earliestB; // Group by student earliest upload
                }
                
                const timeA = a.dateTime ? new Date(a.dateTime).getTime() : 0;
                const timeB = b.dateTime ? new Date(b.dateTime).getTime() : 0;
                return timeA - timeB; // Chronological order inside student's group
            });

            const fragment = document.createDocumentFragment();
            async function markCardViewed(cardId) {
                const card = cards.find(c => c.id.toString() === cardId.toString());
                if (card && card.status === 'card_new') {
                    card.status = 'card';
                    try {
                        await window.tuitionStore.updatePayment({ id: card.id, status: 'card' });
                        const badge = document.getElementById(`new-badge-${card.id}`);
                        if (badge) badge.style.display = 'none';
                    } catch (err) {
                        console.error('Failed to update card status:', err);
                    }
                }
            }

            for (const card of cards) {
                let cleanName = 'ไม่ระบุชื่อ';
                let cardId = card.studentId;
                let rawRoom = '';
                let rawYear = '';

                if (card.comment && card.comment.startsWith('CARD_INFO:')) {
                    try {
                        const info = JSON.parse(card.comment.substring(10));
                        cleanName = info.name;
                        cardId = info.id;
                        rawRoom = info.room || '';
                        rawYear = info.year || '';
                    } catch (e) {
                        console.error("Error parsing card info:", e);
                    }
                } else {
                    const student = studentMap[card.studentId];
                    const stdName = student ? student.name : 'ไม่ระบุชื่อ';
                    cleanName = getCleanName(stdName);
                    rawRoom = student ? (student.room || '') : '';
                    rawYear = student ? (student.year || '') : '';
                }

                // Clean prefix labels from inputs if they exist (e.g. "ห้อง ", "รุ่น ")
                let schoolName = rawRoom.trim();
                if (schoolName.startsWith('ห้อง ')) {
                    schoolName = schoolName.substring(5).trim();
                }
                let workplaceName = rawYear.trim();
                if (workplaceName.startsWith('รุ่น ')) {
                    workplaceName = workplaceName.substring(5).trim();
                }

                if (!schoolName) schoolName = '-';
                if (!workplaceName) workplaceName = '-';

                const seq = cardSeqMap[card.id] || 1;
                const downloadFilename = `${cardId} (${seq}).png`;

                const formattedDate = new Date(card.dateTime).toLocaleString('th-TH', {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }).replace(':', '.');

                const isNew = card.status === 'card_new';
                const newBadgeHtml = isNew ? `<div id="new-badge-${card.id}" style="position: absolute; top: 0; left: 0; background: #e02424; color: white; padding: 4px 10px; border-radius: 0; font-size: 11px; font-weight: 700; z-index: 2; letter-spacing: 0.5px;">NEW</div>` : '';

                const item = document.createElement('div');
                item.className = 'slip-gallery-card';
                item.style.background = 'var(--neutral-light)';
                item.style.borderRadius = '16px';
                item.style.padding = '16px';
                item.style.border = '1px solid var(--neutral-border)';
                item.style.display = 'flex';
                item.style.flexDirection = 'column';
                item.style.gap = '12px';
                item.style.transition = 'transform 0.25s ease, box-shadow 0.25s ease';
                
                item.onmouseover = () => {
                    item.style.transform = 'translateY(-4px)';
                    item.style.boxShadow = 'var(--shadow-md)';
                };
                item.onmouseout = () => {
                    item.style.transform = 'none';
                    item.style.boxShadow = 'none';
                };

                item.innerHTML = `
                    <div class="card-image-box" style="width: 100%; aspect-ratio: 2 / 3; height: auto; border-radius: 0; overflow: hidden; background: #f0f0f0; border: none; position: relative; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                        ${newBadgeHtml}
                        <span class="lazy-spinner" style="width: 24px; height: 24px; border: 3px solid #ccc; border-top-color: #333; border-radius: 50%; animation: spin 1s linear infinite;"></span>
                        <img class="lazy-slip-image" data-id="${card.id}" src="" style="width: 100%; height: 100%; object-fit: contain; display: none;" alt="ภาพฝึกงาน">
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div style="font-size: 14px; font-weight: 700; color: var(--neutral-dark);">${cleanName} (${seq})</div>
                        <div style="font-size: 12px; color: #86868b; font-weight: 500;">รหัสประจำตัว: ${cardId}</div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 4px;">
                        <button class="btn-modern btn-modern-secondary btn-modern-sm btn-admin-download-card" data-card-id="${card.id}" data-href="" data-filename="${downloadFilename}" style="flex: 1; height: 36px; padding: 0; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px;">
                            <i class="fa-solid fa-download"></i> ดาวน์โหลด
                        </button>
                        <button class="btn-modern btn-modern-danger btn-modern-sm btn-admin-delete-card" data-card-id="${card.id}" data-student-name="${cleanName}" style="height: 36px; width: 36px; min-width: 36px; padding: 0; font-size: 13px; display: flex; align-items: center; justify-content: center;" title="ลบรูปภาพ">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                `;

                // Expand preview image click handler
                item.querySelector('.card-image-box').addEventListener('click', () => {
                    const modal = document.getElementById('modal-receipt');
                    const modalContent = document.querySelector('#modal-receipt .premium-modal-content');
                    const slipViewer = document.getElementById('receipt-slip-viewer');
                    const slipImg = document.getElementById('receipt-slip-img');
                    const downloadBtn = document.getElementById('btn-download-slip');
                    
                    if (modal && slipViewer && slipImg) {
                        slipViewer.style.display = 'block';
                        slipImg.src = '';
                        let loader = document.getElementById('full-img-loader');
                        if (!loader) { loader = document.createElement('div'); loader.id = 'full-img-loader'; loader.style = 'color:white;text-align:center;margin-top:20px;'; slipViewer.prepend(loader); }
                        loader.innerText = 'กำลังโหลดภาพขนาดปกติ...';
                        loader.style.display = 'block';
                        
                        const loadImg = async () => {
                            let b64 = card.slipImage;
                            if (!b64) { b64 = await window.tuitionStore.getPaymentImage(card.id); card.slipImage = b64; }
                            if (b64) { slipImg.src = b64; loader.style.display = 'none'; if(downloadBtn) downloadBtn.href = b64; }
                            else { loader.innerText = 'ไม่สามารถโหลดภาพได้'; }
                        };
                        loadImg();
                        
                        if (downloadBtn) {
                            downloadBtn.download = downloadFilename;
                            downloadBtn.onclick = () => markCardViewed(card.id);
                        }
                        
                        const paperReceipt = document.querySelector('.receipt-paper');
                        if (paperReceipt) paperReceipt.style.display = 'none';
                        const printBtn = document.getElementById('btn-receipt-print');
                        if (printBtn && printBtn.parentElement) printBtn.parentElement.style.display = 'none';

                        if (modalContent) {
                            modalContent.style.background = 'transparent';
                            modalContent.style.border = 'none';
                            modalContent.style.boxShadow = 'none';
                            modalContent.style.padding = '0';
                            modalContent.style.position = 'relative';
                        }
                        
                        const closeBtn = document.getElementById('btn-close-receipt-modal');
                        if (closeBtn) {
                            closeBtn.style.background = 'rgba(0,0,0,0.55)';
                            closeBtn.style.color = '#fff';
                            closeBtn.style.border = 'none';
                            closeBtn.style.position = 'absolute';
                            closeBtn.style.top = '-12px';
                            closeBtn.style.right = '-12px';
                            closeBtn.style.zIndex = '10';
                            
                            closeBtn.onclick = () => {
                                modal.classList.remove('active');
                                if (modalContent) {
                                    modalContent.style.background = '';
                                    modalContent.style.border = '';
                                    modalContent.style.boxShadow = '';
                                    modalContent.style.padding = '';
                                    modalContent.style.position = '';
                                }
                                closeBtn.style.background = '';
                                closeBtn.style.color = '';
                                closeBtn.style.border = '';
                                closeBtn.style.position = '';
                                closeBtn.style.top = '';
                                closeBtn.style.right = '';
                                closeBtn.style.zIndex = '';
                            };
                        }
                        
                        modal.classList.add('active');
                    }
                });

                fragment.appendChild(item);
            }

            if (!document.getElementById('lazy-spinner-style')) {
                const style = document.createElement('style');
                style.id = 'lazy-spinner-style';
                style.innerHTML = '@keyframes spin { 100% { transform: rotate(360deg); } }';
                document.head.appendChild(style);
            }

            const observer = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const box = entry.target;
                        const img = box.querySelector('.lazy-slip-image');
                        const spinner = box.querySelector('.lazy-spinner');
                        if (!img) return;
                        
                        const id = img.getAttribute('data-id');
                        const cardObj = cards.find(c => c.id.toString() === id.toString());
                        let thumbBase64 = null;
                        if (cardObj && cardObj.comment && cardObj.comment.startsWith('CARD_INFO:')) {
                            try {
                                const info = JSON.parse(cardObj.comment.substring(10));
                                if (info.thumb) thumbBase64 = info.thumb;
                            } catch (e) {}
                        }

                        if (thumbBase64) {
                            img.src = thumbBase64;
                            img.style.display = 'block';
                            if (spinner) spinner.style.display = 'none';
                            box.style.background = 'transparent';
                            observer.unobserve(box);
                        } else {
                            window.tuitionStore.getPaymentImage(id).then(base64 => {
                                if (base64) {
                                    img.src = base64;
                                    img.style.display = 'block';
                                    if (cardObj) cardObj.slipImage = base64;
                                    
                                    const cardContainer = box.closest('.slip-gallery-card');
                                    if (cardContainer) {
                                        const dlBtn = cardContainer.querySelector('.btn-admin-download-card');
                                        if (dlBtn) dlBtn.setAttribute('data-href', base64);
                                    }

                                    // Migrate missing thumb
                                    window.tuitionStore.generateThumbnail(base64).then(thumb => {
                                        if (thumb && cardObj) {
                                            let info = {};
                                            if (cardObj.comment && cardObj.comment.startsWith('CARD_INFO:')) {
                                                try { info = JSON.parse(cardObj.comment.substring(10)); } catch(e){}
                                            }
                                            info.thumb = thumb;
                                            window.tuitionStore.updatePayment({ id: cardObj.id, comment: "CARD_INFO:" + JSON.stringify(info) }).catch(()=>{});
                                        }
                                    });
                                }
                                if (spinner) spinner.style.display = 'none';
                                box.style.background = 'transparent';
                            });
                            observer.unobserve(box);
                        }
                    }
                });
            }, { rootMargin: '100px' });

            fragment.querySelectorAll('.card-image-box').forEach(box => observer.observe(box));

            gallery.innerHTML = '';
            gallery.appendChild(fragment);

            // Bind download buttons
            gallery.querySelectorAll('.btn-admin-download-card').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const cardId = btn.getAttribute('data-card-id');
                    if (cardId) markCardViewed(cardId);
                    const a = document.createElement('a');
                    a.href = btn.getAttribute('data-href');
                    a.download = btn.getAttribute('data-filename');
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                });
            });

            // Bind delete buttons
            gallery.querySelectorAll('.btn-admin-delete-card').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const cardId = btn.getAttribute('data-card-id');
                    const studentName = btn.getAttribute('data-student-name');
                    
                    if (confirm(`คุณแน่ใจหรือไม่ที่จะลบรูปภาพฝึกงานของ "${studentName}"?\nการดำเนินการนี้ไม่สามารถย้อนคืนได้`)) {
                        try {
                            btn.disabled = true;
                            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                            await window.tuitionStore.deleteIntroCard(cardId);
                            alert('ลบรูปภาพฝึกงานเรียบร้อยแล้ว');
                            await notifyDbUpdate('payments', 'ALL');
                        } catch (err) {
                            console.error('Delete card error:', err);
                            alert(`❌ เกิดข้อผิดพลาดในการลบรูปภาพ: ${err.message || JSON.stringify(err)}`);
                        } finally {
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
                        }
                    }
                });
            });

        } catch (err) {
            console.error('Render admin cards error:', err);
            gallery.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--danger-text); padding: 40px;"><i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถดึงข้อมูลรูปภาพการแนะนำตัวได้: ${err.message || JSON.stringify(err)}</div>`;
        }
    }

    async function renderStudentAlbum() {
        const gallery = document.getElementById('student-album-gallery');
        const emptyState = document.getElementById('album-empty-state');
        if (!gallery || !emptyState) return;

        try {
            const cards = await window.tuitionStore.getIntroCards();
            
            if (cards.length === 0) {
                emptyState.style.display = 'block';
                gallery.style.display = 'none';
                return;
            }

            const studentsList = await window.tuitionStore.getStudents();
            const studentMap = {};
            studentsList.forEach(s => {
                studentMap[s.id] = s;
            });

            emptyState.style.display = 'none';
            gallery.style.display = 'grid';

            // Precalculate chronological sequence numbers per student (oldest to newest)
            const cardSeqMap = {};
            const cardsWithId = cards.map(c => {
                let actualId = c.studentId;
                if (c.comment && c.comment.startsWith('CARD_INFO:')) {
                    try {
                        const info = JSON.parse(c.comment.substring(10));
                        actualId = info.id;
                    } catch (e) {}
                }
                return { c, actualId };
            });

            cardsWithId.sort((a, b) => {
                return new Date(a.c.dateTime).getTime() - new Date(b.c.dateTime).getTime();
            });

            const studentCounts = {};
            const earliestUploadMap = {};
            const cardToStudentIdMap = {};
            
            cardsWithId.forEach(item => {
                const id = item.actualId;
                cardToStudentIdMap[item.c.id] = id;
                const time = new Date(item.c.dateTime).getTime();
                
                if (earliestUploadMap[id] === undefined || time < earliestUploadMap[id]) {
                    earliestUploadMap[id] = time;
                }
                
                if (!studentCounts[id]) {
                    studentCounts[id] = 0;
                }
                studentCounts[id]++;
                cardSeqMap[item.c.id] = studentCounts[id];
            });

            cards.sort((a, b) => {
                const sIdA = cardToStudentIdMap[a.id];
                const sIdB = cardToStudentIdMap[b.id];
                
                const earliestA = earliestUploadMap[sIdA] || 0;
                const earliestB = earliestUploadMap[sIdB] || 0;
                
                if (earliestA !== earliestB) {
                    return earliestA - earliestB; // Group by student earliest upload
                }
                
                const timeA = a.dateTime ? new Date(a.dateTime).getTime() : 0;
                const timeB = b.dateTime ? new Date(b.dateTime).getTime() : 0;
                return timeA - timeB; // Chronological order inside student's group
            });

            const fragment = document.createDocumentFragment();
            for (const card of cards) {
                let cleanName = 'ไม่ระบุชื่อ';
                let cardId = card.studentId;

                if (card.comment && card.comment.startsWith('CARD_INFO:')) {
                    try {
                        const info = JSON.parse(card.comment.substring(10));
                        cleanName = info.name;
                        cardId = info.id;
                    } catch (e) {
                        console.error("Error parsing card info:", e);
                    }
                } else {
                    const student = studentMap[card.studentId];
                    const stdName = student ? student.name : 'ไม่ระบุชื่อ';
                    cleanName = getCleanName(stdName);
                }

                const seq = cardSeqMap[card.id] || 1;

                const item = document.createElement('div');
                item.className = 'slip-gallery-card';
                item.style.background = 'var(--neutral-light)';
                item.style.borderRadius = '16px';
                item.style.padding = '16px';
                item.style.border = '1px solid var(--neutral-border)';
                item.style.display = 'flex';
                item.style.flexDirection = 'column';
                item.style.gap = '12px';
                item.style.transition = 'transform 0.25s ease, box-shadow 0.25s ease';
                
                item.onmouseover = () => {
                    item.style.transform = 'translateY(-4px)';
                    item.style.boxShadow = 'var(--shadow-md)';
                };
                item.onmouseout = () => {
                    item.style.transform = 'none';
                    item.style.boxShadow = 'none';
                };

                item.innerHTML = `
                    <div class="card-image-box" style="width: 100%; aspect-ratio: 2 / 3; height: auto; border-radius: 0; overflow: hidden; background: #f0f0f0; border: none; position: relative; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                        <span class="lazy-spinner" style="width: 24px; height: 24px; border: 3px solid #ccc; border-top-color: #333; border-radius: 50%; animation: spin 1s linear infinite;"></span>
                        <img class="lazy-slip-image" data-id="${card.id}" src="" style="width: 100%; height: 100%; object-fit: contain; display: none;" alt="ภาพฝึกงาน">
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div style="font-size: 14px; font-weight: 700; color: var(--neutral-dark); text-align: center;">${cleanName} (${seq})</div>
                        <div style="font-size: 12px; color: #86868b; font-weight: 500; text-align: center;">รหัสประจำตัว: ${cardId}</div>
                    </div>
                `;

                // Expand preview image click handler
                item.querySelector('.card-image-box').addEventListener('click', () => {
                    const modal = document.getElementById('modal-receipt');
                    const modalContent = document.querySelector('#modal-receipt .premium-modal-content');
                    const slipViewer = document.getElementById('receipt-slip-viewer');
                    const slipImg = document.getElementById('receipt-slip-img');
                    const downloadBtn = document.getElementById('btn-download-slip');
                    
                    if (modal && slipViewer && slipImg) {
                        slipViewer.style.display = 'block';
                        slipImg.src = '';
                        let loader = document.getElementById('full-img-loader');
                        if (!loader) { loader = document.createElement('div'); loader.id = 'full-img-loader'; loader.style = 'color:white;text-align:center;margin-top:20px;'; slipViewer.prepend(loader); }
                        loader.innerText = 'กำลังโหลดภาพขนาดปกติ...';
                        loader.style.display = 'block';
                        
                        const loadImg = async () => {
                            let b64 = card.slipImage;
                            if (!b64) { b64 = await window.tuitionStore.getPaymentImage(card.id); card.slipImage = b64; }
                            if (b64) { slipImg.src = b64; loader.style.display = 'none'; }
                            else { loader.innerText = 'ไม่สามารถโหลดภาพได้'; }
                        };
                        loadImg();
                        
                        if (downloadBtn) {
                            downloadBtn.style.display = 'none';
                        }
                        
                        const paperReceipt = document.querySelector('.receipt-paper');
                        if (paperReceipt) paperReceipt.style.display = 'none';
                        const printBtn = document.getElementById('btn-receipt-print');
                        if (printBtn && printBtn.parentElement) printBtn.parentElement.style.display = 'none';

                        if (modalContent) {
                            modalContent.style.background = 'transparent';
                            modalContent.style.border = 'none';
                            modalContent.style.boxShadow = 'none';
                            modalContent.style.padding = '0';
                            modalContent.style.position = 'relative';
                        }
                        
                        const closeBtn = document.getElementById('btn-close-receipt-modal');
                        if (closeBtn) {
                            closeBtn.style.background = 'rgba(0,0,0,0.55)';
                            closeBtn.style.color = '#fff';
                            closeBtn.style.border = 'none';
                            closeBtn.style.position = 'absolute';
                            closeBtn.style.top = '-12px';
                            closeBtn.style.right = '-12px';
                            closeBtn.style.zIndex = '10';
                            
                            closeBtn.onclick = () => {
                                modal.classList.remove('active');
                                if (modalContent) {
                                    modalContent.style.background = '';
                                    modalContent.style.border = '';
                                    modalContent.style.boxShadow = '';
                                    modalContent.style.padding = '';
                                    modalContent.style.position = '';
                                }
                                closeBtn.style.background = '';
                                closeBtn.style.color = '';
                                closeBtn.style.border = '';
                                closeBtn.style.position = '';
                                closeBtn.style.top = '';
                                closeBtn.style.right = '';
                                closeBtn.style.zIndex = '';
                                if (downloadBtn) downloadBtn.style.display = '';
                            };
                        }
                        
                        modal.classList.add('active');
                    }
                });

                fragment.appendChild(item);
            }

            if (!document.getElementById('lazy-spinner-style')) {
                const style = document.createElement('style');
                style.id = 'lazy-spinner-style';
                style.innerHTML = '@keyframes spin { 100% { transform: rotate(360deg); } }';
                document.head.appendChild(style);
            }

            const observer2 = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const box = entry.target;
                        const img = box.querySelector('.lazy-slip-image');
                        const spinner = box.querySelector('.lazy-spinner');
                        if (!img) return;
                        
                        const id = img.getAttribute('data-id');
                        const cardObj = cards.find(c => c.id.toString() === id.toString());
                        let thumbBase64 = null;
                        if (cardObj && cardObj.comment && cardObj.comment.startsWith('CARD_INFO:')) {
                            try {
                                const info = JSON.parse(cardObj.comment.substring(10));
                                if (info.thumb) thumbBase64 = info.thumb;
                            } catch (e) {}
                        }

                        if (thumbBase64) {
                            img.src = thumbBase64;
                            img.style.display = 'block';
                            if (spinner) spinner.style.display = 'none';
                            box.style.background = 'transparent';
                            observer.unobserve(box);
                        } else {
                            window.tuitionStore.getPaymentImage(id).then(base64 => {
                                if (base64) {
                                    img.src = base64;
                                    img.style.display = 'block';
                                    if (cardObj) cardObj.slipImage = base64;
                                    
                                    window.tuitionStore.generateThumbnail(base64).then(thumb => {
                                        if (thumb && cardObj) {
                                            let info = {};
                                            if (cardObj.comment && cardObj.comment.startsWith('CARD_INFO:')) {
                                                try { info = JSON.parse(cardObj.comment.substring(10)); } catch(e){}
                                            }
                                            info.thumb = thumb;
                                            window.tuitionStore.updatePayment({ id: cardObj.id, comment: "CARD_INFO:" + JSON.stringify(info) }).catch(()=>{});
                                        }
                                    });
                                }
                                if (spinner) spinner.style.display = 'none';
                                box.style.background = 'transparent';
                            });
                            observer.unobserve(box);
                        }
                    }
                });
            }, { rootMargin: '100px' });

            fragment.querySelectorAll('.card-image-box').forEach(box => observer2.observe(box));

            gallery.innerHTML = '';
            gallery.appendChild(fragment);

        } catch (err) {
            console.error('Render student album error:', err);
            gallery.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--danger-text); padding: 40px;"><i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถดึงข้อมูลอัลบั้มได้: ${err.message || JSON.stringify(err)}</div>`;
        }
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
        const cleanStdName = getCleanName(stdName);
        const fundingText = getFundingText(student);

        // Set inspector headers & info details
        document.getElementById('inspector-student-name').textContent = `ตรวจสอบสลิป`;
        
        const detailFunding = document.getElementById('inspector-detail-funding');
        if (detailFunding) {
            detailFunding.innerHTML = `<span class="status-badge ${fundingText === 'กยศ' ? 'badge-gys' : 'badge-self'}">${fundingText}</span>`;
        }
        
        const detailId = document.getElementById('inspector-detail-id');
        if (detailId) detailId.textContent = payment.studentId;
        
        const detailName = document.getElementById('inspector-detail-name');
        if (detailName) detailName.textContent = cleanStdName;

        document.getElementById('inspector-detail-amount').textContent = payment.amount > 0 ? `${payment.amount.toLocaleString()} บาท` : 'ไม่ระบุยอด (อ้างอิงจากสลิป)';
        
        const formattedDate = new Date(payment.dateTime).toLocaleString('th-TH', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
        }).replace(':', '.');
        document.getElementById('inspector-detail-datetime').textContent = `${formattedDate} น.`;

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

        // 1. PINCH-TO-ZOOM & PAN CONTROLS
        const viewport = document.getElementById('slip-viewer-viewport');
        let initialDistance = 0;
        let initialZoom = 1.0;
        let startX = 0;
        let startY = 0;
        let initialPanX = 0;
        let initialPanY = 0;

        viewport.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].pageX - e.touches[1].pageX;
                const dy = e.touches[0].pageY - e.touches[1].pageY;
                initialDistance = Math.sqrt(dx*dx + dy*dy);
                initialZoom = state.zoomLevel;
            } else if (e.touches.length === 1 && state.zoomLevel > 1.0) {
                e.preventDefault();
                startX = e.touches[0].pageX;
                startY = e.touches[0].pageY;
                initialPanX = state.panX || 0;
                initialPanY = state.panY || 0;
            }
        }, { passive: false });

        viewport.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].pageX - e.touches[1].pageX;
                const dy = e.touches[0].pageY - e.touches[1].pageY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                state.zoomLevel = initialZoom * (dist / initialDistance);
                if (state.zoomLevel < 0.5) state.zoomLevel = 0.5;
                if (state.zoomLevel > 5.0) state.zoomLevel = 5.0;
                applyViewerTransforms();
            } else if (e.touches.length === 1 && state.zoomLevel > 1.0) {
                e.preventDefault();
                const dx = e.touches[0].pageX - startX;
                const dy = e.touches[0].pageY - startY;
                state.panX = initialPanX + dx;
                state.panY = initialPanY + dy;
                applyViewerTransforms();
            }
        }, { passive: false });
        
        // Mouse wheel zooming
        viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                state.zoomLevel += 0.1;
            } else {
                state.zoomLevel -= 0.1;
            }
            if (state.zoomLevel < 0.5) state.zoomLevel = 0.5;
            if (state.zoomLevel > 5.0) state.zoomLevel = 5.0;
            applyViewerTransforms();
        }, { passive: false });

        // Mouse dragging for pan
        let isDragging = false;
        viewport.addEventListener('mousedown', (e) => {
            if (state.zoomLevel > 1.0) {
                isDragging = true;
                startX = e.pageX;
                startY = e.pageY;
                initialPanX = state.panX || 0;
                initialPanY = state.panY || 0;
                viewport.style.cursor = 'grabbing';
            }
        });
        window.addEventListener('mousemove', (e) => {
            if (isDragging && state.zoomLevel > 1.0) {
                const dx = e.pageX - startX;
                const dy = e.pageY - startY;
                state.panX = initialPanX + dx;
                state.panY = initialPanY + dy;
                applyViewerTransforms();
            }
        });
        window.addEventListener('mouseup', () => {
            isDragging = false;
            viewport.style.cursor = '';
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

        // 6. SHARE TO LINE / OS NATIVE SHARE
        document.getElementById('btn-viewer-share').addEventListener('click', async () => {
            if (!state.inspectorPaymentId) return;
            const payment = await window.tuitionStore.getPaymentById(state.inspectorPaymentId);
            if (!payment) return;

            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

            if (isMobile && navigator.share) {
                try {
                    // Try to share the image as a file (Works on iOS Safari and Android Chrome)
                    if (payment.slipImage.startsWith('data:')) {
                        const response = await fetch(payment.slipImage);
                        const blob = await response.blob();
                        const file = new File([blob], payment.slipName || `slip_${payment.studentId}.png`, { type: blob.type });
                        
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file]
                            });
                            return;
                        }
                    }
                    // Fallback if file sharing is unsupported
                    alert("เบราว์เซอร์ของคุณไม่รองรับการแชร์ไฟล์รูปภาพโดยตรง กรุณากดปุ่มดาวน์โหลดแทนครับ");
                } catch (err) {
                    console.log('User cancelled share or share failed', err);
                }
            } else {
                // Desktop fallback: Cannot share image blob via LINE URL
                alert("บนคอมพิวเตอร์ ระบบแชร์ของ LINE ไม่รองรับการแนบรูปภาพโดยตรง\n\nแนะนำให้กดปุ่ม 'ดาวน์โหลดไฟล์สลิป' แล้วลากรูปที่โหลดไปวางในช่องแชท LINE แทนครับ!");
            }
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
        if (state.zoomLevel <= 1.0) {
            state.panX = 0;
            state.panY = 0;
        }
        img.style.transform = `translate(${state.panX || 0}px, ${state.panY || 0}px) scale(${state.zoomLevel}) rotate(${state.rotationAngle}deg)`;
    }


    // =========================================================================
    // MODAL: OFFICIAL E-RECEIPT
    // =========================================================================
    async function showReceiptModal(paymentId, fromGallery = false) {
        const payment = await window.tuitionStore.getPaymentById(paymentId);
        if (!payment) return;

        // Populate receipt modal fields dynamically
        const student = await window.tuitionStore.getStudentById(payment.studentId);
        if (student) {
            const cleanName = getCleanName(student.name);
            const fundingText = getFundingText(student);
            const receiptName = document.getElementById('receipt-student-name');
            if (receiptName) receiptName.textContent = cleanName;
            
            const receiptClass = document.getElementById('receipt-student-class');
            if (receiptClass) receiptClass.textContent = `ปี ${student.year || student.generation || '1'} ห้อง ${student.room || '1'} (${fundingText})`;
            
            const receiptStudentId = document.getElementById('receipt-student-id');
            if (receiptStudentId) receiptStudentId.textContent = student.id;
        }

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

        // Make modal-content transparent — slip floats over blurred backdrop
        const modalContent = document.querySelector('#modal-receipt .premium-modal-content');
        if (modalContent) {
            modalContent.style.background = 'transparent';
            modalContent.style.border = 'none';
            modalContent.style.boxShadow = 'none';
            modalContent.style.padding = '0';
        }

        // Also make the close button float visibly over the slip
        const closeBtn = document.getElementById('btn-close-receipt-modal');
        if (closeBtn) {
            closeBtn.style.background = 'rgba(0,0,0,0.55)';
            closeBtn.style.color = '#fff';
            closeBtn.style.border = 'none';
            closeBtn.style.position = 'absolute';
            closeBtn.style.top = '-12px';
            closeBtn.style.right = '-12px';
            closeBtn.style.zIndex = '10';
        }
        if (modalContent) modalContent.style.position = 'relative';

        // Open Receipt Modal
        const modal = document.getElementById('modal-receipt');
        modal.classList.add('active');

        // Modal close button — restore styles on close
        document.getElementById('btn-close-receipt-modal').onclick = () => {
            modal.classList.remove('active');
            // Restore modal-content styles for next use
            if (modalContent) {
                modalContent.style.background = '';
                modalContent.style.border = '';
                modalContent.style.boxShadow = '';
                modalContent.style.padding = '';
                modalContent.style.position = '';
            }
            if (closeBtn) {
                closeBtn.style.background = '';
                closeBtn.style.color = '';
                closeBtn.style.border = '';
                closeBtn.style.position = '';
                closeBtn.style.top = '';
                closeBtn.style.right = '';
                closeBtn.style.zIndex = '';
            }
            if (fromGallery) {
                document.getElementById('modal-student-slips').classList.add('active');
            }
        };
    }

    // --- PWA Installation Logic ---
    let deferredPrompt;
    const installBtn = document.getElementById('btn-install-pwa');
    const installDivider = document.getElementById('install-pwa-divider');
    const iosToast = document.getElementById('ios-pwa-toast');
    const btnCloseIosToast = document.getElementById('btn-close-ios-toast');

    function showInstallButton() {
        if (installBtn) installBtn.style.display = 'flex';
        if (installDivider) installDivider.style.display = 'block';
    }

    function hideInstallButton() {
        if (installBtn) installBtn.style.display = 'none';
        if (installDivider) installDivider.style.display = 'none';
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW failed:', err));
        });
    }

    // Android/Chrome Install Prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        showInstallButton();
    });

    if (installBtn) {
        installBtn.addEventListener('click', (e) => {
            // Close mobile menu if open
            const dropdown = document.getElementById('mobile-nav-dropdown');
            const hamburger = document.getElementById('btn-hamburger');
            if (dropdown && dropdown.classList.contains('active')) {
                dropdown.classList.remove('active');
                hamburger.classList.remove('active');
            }

            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        hideInstallButton();
                    }
                    deferredPrompt = null;
                });
            } else {
                const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
                if (isIos) {
                    iosToast.style.display = 'flex';
                } else {
                    alert("กรุณากดเมนูจุดๆ ของเบราว์เซอร์แล้วเลือก 'Add to Home Screen' (เพิ่มลงในหน้าจอหลัก) หรือ 'ติดตั้งแอป'");
                }
            }
        });
    }

    // iOS Check for displaying the button anyway since beforeinstallprompt doesn't fire
    const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator.standalone);

    if (isIos && !isInStandaloneMode && installBtn) {
        showInstallButton();
    }

    if (btnCloseIosToast) {
        btnCloseIosToast.addEventListener('click', () => {
            iosToast.style.display = 'none';
        });
    }

    window.addEventListener('appinstalled', (evt) => {
        hideInstallButton();
        if (iosToast) iosToast.style.display = 'none';
    });
    
    // Theme Picker Setup
    const btnThemePicker = document.getElementById('btn-theme-picker');
    const themeMenu = document.getElementById('theme-picker-menu');
    const themeBanner = document.getElementById('student-hero-banner');
    const btnSaveTheme = document.getElementById('btn-save-theme');
    let selectedPreviewTheme = null;
    
    if (btnThemePicker && themeMenu && themeBanner) {
        btnThemePicker.addEventListener('click', (e) => {
            e.stopPropagation();
            themeMenu.classList.toggle('active');
            if (btnSaveTheme) btnSaveTheme.style.display = 'none';
            selectedPreviewTheme = state.currentStudent ? (state.currentStudent.theme || 'theme-default') : 'theme-default';
        });
        
        document.addEventListener('click', (e) => {
            if (!themeMenu.contains(e.target) && !btnThemePicker.contains(e.target)) {
                themeMenu.classList.remove('active');
                if (btnSaveTheme) btnSaveTheme.style.display = 'none';
                // Revert preview if not saved
                if (state.currentStudent) {
                    themeBanner.className = 'student-hero-banner ' + (state.currentStudent.theme || 'theme-default');
                }
            }
        });
        
        themeMenu.querySelectorAll('.theme-swatch').forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedPreviewTheme = swatch.dataset.theme;
                themeBanner.className = 'student-hero-banner ' + selectedPreviewTheme;
                if (btnSaveTheme) btnSaveTheme.style.display = 'block';
            });
        });

        if (btnSaveTheme) {
            btnSaveTheme.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedPreviewTheme && state.currentStudent) {
                    state.currentStudent.theme = selectedPreviewTheme;
                    
                    // Save to local storage
                    localStorage.setItem('student_theme_' + state.currentStudent.id, selectedPreviewTheme);
                    
                    // Visual feedback
                    const oldText = btnSaveTheme.textContent;
                    btnSaveTheme.textContent = 'สำเร็จ!';
                    btnSaveTheme.style.background = 'var(--success)';
                    
                    setTimeout(() => {
                        themeMenu.classList.remove('active');
                        btnSaveTheme.style.display = 'none';
                        btnSaveTheme.textContent = oldText;
                        btnSaveTheme.style.background = 'var(--primary)';
                    }, 800);
                }
            });
        }
    }

    // Initialize Image Tool logic
    initImageTool();

    // =========================================================================
    // IMAGE TOOL LOGIC
    // =========================================================================
    function initImageTool() {
        const fileInput = document.getElementById('img-tool-file-input');
        const downloadBtn = document.getElementById('btn-download-img-tool');
        
        const previewImg = document.getElementById('img-tool-preview-img');
        const previewPlaceholder = document.getElementById('preview-img-placeholder');
        const cropArea = document.getElementById('img-tool-crop-area');
        const btnClearImg = document.getElementById('btn-clear-img');
        
        const line1Input = document.getElementById('img-tool-line1');
        const rahasInput = document.getElementById('img-tool-rahas');
        const line2Input = document.getElementById('img-tool-line2');
        const line3Input = document.getElementById('img-tool-line3');
        
        const lblLine1 = document.getElementById('preview-lbl-line1');
        const lblLine2 = document.getElementById('preview-lbl-line2');
        const lblLine3 = document.getElementById('preview-lbl-line3');
        
        let img = new Image();
        let hasImage = false;
        let scale = 1;
        let offsetX = 0;
        let offsetY = 0;
        let baseWidth = 0;
        let baseHeight = 0;
        
        const getWrapperWidth = () => cropArea.clientWidth || 380;
        const getWrapperHeight = () => cropArea.clientHeight || 400;

        function getLine1DefaultName() {
            return state.currentStudent ? getCleanName(state.currentStudent.name) : 'นายศิระ ยอแสง';
        }
        function getLine1DefaultRahas() {
            return state.currentStudent ? state.currentStudent.id : '250001';
        }
        function getLine2Default() {
            return 'โรงเรียนเดิม';
        }
        function getLine3Default() {
            return 'บริษัท';
        }

        // Sync inputs with preview labels
        function updateLabels() {
            const namePart = line1Input.value.trim() || getLine1DefaultName();
            const rahasPart = rahasInput.value.trim() || getLine1DefaultRahas();
            lblLine1.textContent = `${namePart} ${rahasPart}`;
            lblLine2.textContent = line2Input.value.trim() || getLine2Default();
            lblLine3.textContent = line3Input.value.trim() || getLine3Default();
        }
        
        [line1Input, rahasInput, line2Input, line3Input].forEach(inp => {
            if (inp) inp.addEventListener('input', updateLabels);
        });

        // Initialize values when student logs in
        function populateDefaults() {
            if (state.currentStudent) {
                line1Input.value = getCleanName(state.currentStudent.name);
                rahasInput.value = state.currentStudent.id;
                line2Input.value = 'โรงเรียนเดิม';
                line3Input.value = 'บริษัท';
            } else {
                line1Input.value = '';
                rahasInput.value = '';
                line2Input.value = '';
                line3Input.value = '';
            }
            
            line1Input.placeholder = getLine1DefaultName();
            rahasInput.placeholder = getLine1DefaultRahas();
            line2Input.placeholder = getLine2Default();
            line3Input.placeholder = getLine3Default();
            
            updateLabels();
        }

        // Handle file select
        function handleFile(file) {
            if (!file || !file.type.startsWith('image/')) return;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
        
        img.onload = () => {
            if (!img.src) return;
            hasImage = true;
            previewImg.src = img.src;
            previewImg.style.display = 'block';
            previewPlaceholder.style.display = 'none';
            if (btnClearImg) btnClearImg.style.display = 'flex';
            cropArea.style.cursor = 'grab';
            
            // Calculate cover size
            const currentWrapperWidth = getWrapperWidth();
            const currentWrapperHeight = getWrapperHeight();
            const imgAspect = img.naturalWidth / img.naturalHeight;
            const wrapperAspect = currentWrapperWidth / currentWrapperHeight;
            
            if (imgAspect > wrapperAspect) {
                baseHeight = currentWrapperHeight;
                baseWidth = currentWrapperHeight * imgAspect;
            } else {
                baseWidth = currentWrapperWidth;
                baseHeight = currentWrapperWidth / imgAspect;
            }
            
            // Reset position
            scale = 1;
            offsetX = 0;
            offsetY = 0;
            
            updateImageTransform();
        };

        function updateImageTransform() {
            // Prevent zooming out smaller than the container
            if (scale < 1) scale = 1;
            if (scale > 10) scale = 10;
            
            const cw = getWrapperWidth();
            const ch = getWrapperHeight();
            
            // Calculate max allowed offsets to prevent empty space
            const maxOffsetX = Math.max(0, (baseWidth * scale - cw) / 2);
            const maxOffsetY = Math.max(0, (baseHeight * scale - ch) / 2);
            
            // Clamp X and Y
            if (offsetX > maxOffsetX) offsetX = maxOffsetX;
            if (offsetX < -maxOffsetX) offsetX = -maxOffsetX;
            
            if (offsetY > maxOffsetY) offsetY = maxOffsetY;
            if (offsetY < -maxOffsetY) offsetY = -maxOffsetY;

            previewImg.style.width = `${baseWidth}px`;
            previewImg.style.height = `${baseHeight}px`;
            previewImg.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        }
        
        // Clear/reset image tool
        if (btnClearImg) {
            btnClearImg.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent opening file chooser
                
                // Reset state variables
                img.src = '';
                hasImage = false;
                scale = 1;
                offsetX = 0;
                offsetY = 0;
                baseWidth = 0;
                baseHeight = 0;
                
                // Clear file input
                fileInput.value = '';
                
                // Reset main preview card UI
                previewImg.src = '';
                previewImg.style.display = 'none';
                previewPlaceholder.style.display = 'block';
                btnClearImg.style.display = 'none';
                cropArea.style.cursor = 'pointer';
                cropArea.style.backgroundColor = '#0066cc';
            });
        }

        // Dropzone / click actions directly on cropArea
        cropArea.addEventListener('click', () => {
            if (!hasImage) {
                fileInput.click();
            }
        });
        
        fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
        
        cropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!hasImage) {
                cropArea.style.backgroundColor = '#0077ed';
            }
        });
        
        cropArea.addEventListener('dragleave', () => {
            cropArea.style.backgroundColor = '#0066cc';
        });
        
        cropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            cropArea.style.backgroundColor = '#0066cc';
            if (!hasImage) {
                handleFile(e.dataTransfer.files[0]);
            }
        });

        // Mouse Drag / Panning
        let isDragging = false;
        let startDragX = 0;
        let startDragY = 0;
        let initialOffsetX = 0;
        let initialOffsetY = 0;
        
        function onMouseDown(e) {
            if (!hasImage || e.target.closest('#btn-clear-img')) return;
            isDragging = true;
            cropArea.style.cursor = 'grabbing';
            startDragX = e.clientX;
            startDragY = e.clientY;
            initialOffsetX = offsetX;
            initialOffsetY = offsetY;
        }
        
        function onMouseMove(e) {
            if (!isDragging) return;
            const dx = e.clientX - startDragX;
            const dy = e.clientY - startDragY;
            offsetX = initialOffsetX + dx;
            offsetY = initialOffsetY + dy;
            updateImageTransform();
        }
        
        function onMouseUp() {
            if (isDragging) {
                isDragging = false;
                cropArea.style.cursor = 'grab';
            }
        }

        // Mouse Wheel Zoom
        function onWheel(e) {
            if (!hasImage) return;
            e.preventDefault();
            
            const zoomSpeed = 0.05;
            const delta = -e.deltaY;
            const factor = delta > 0 ? (1 + zoomSpeed) : (1 - zoomSpeed);
            
            const newScale = scale * factor;
            scale = Math.max(0.2, Math.min(10, newScale));
            
            updateImageTransform();
        }

        // Multi-touch Gestures (Drag and Pinch to Zoom)
        let touchMode = 'none'; // 'none', 'drag', 'pinch'
        let initialDistance = 0;
        let initialScale = 1;

        function onTouchStart(e) {
            if (!hasImage || e.target.closest('#btn-clear-img')) return;
            
            if (e.touches.length === 1) {
                touchMode = 'drag';
                startDragX = e.touches[0].clientX;
                startDragY = e.touches[0].clientY;
                initialOffsetX = offsetX;
                initialOffsetY = offsetY;
            } else if (e.touches.length === 2) {
                touchMode = 'pinch';
                initialDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                initialScale = scale;
                startDragX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                startDragY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                initialOffsetX = offsetX;
                initialOffsetY = offsetY;
            }
            e.preventDefault();
        }

        function onTouchMove(e) {
            if (!hasImage) return;
            
            if (touchMode === 'drag' && e.touches.length === 1) {
                const dx = e.touches[0].clientX - startDragX;
                const dy = e.touches[0].clientY - startDragY;
                offsetX = initialOffsetX + dx;
                offsetY = initialOffsetY + dy;
                updateImageTransform();
                e.preventDefault();
            } else if (touchMode === 'pinch' && e.touches.length === 2) {
                const currentDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                
                if (initialDistance > 0) {
                    const newScale = initialScale * (currentDistance / initialDistance);
                    scale = Math.max(0.2, Math.min(10, newScale));
                }
                
                const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                const dx = midX - startDragX;
                const dy = midY - startDragY;
                offsetX = initialOffsetX + dx;
                offsetY = initialOffsetY + dy;
                
                updateImageTransform();
                e.preventDefault();
            }
        }

        function onTouchEnd(e) {
            if (e.touches.length === 0) {
                touchMode = 'none';
            } else if (e.touches.length === 1) {
                touchMode = 'drag';
                startDragX = e.touches[0].clientX;
                startDragY = e.touches[0].clientY;
                initialOffsetX = offsetX;
                initialOffsetY = offsetY;
            }
        }

        // Attach Event Listeners
        cropArea.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        
        cropArea.addEventListener('wheel', onWheel, { passive: false });
        
        cropArea.addEventListener('touchstart', onTouchStart, { passive: false });
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('touchcancel', onTouchEnd);

        // Save logic (modified: saves data to DB, no auto-download)
        let isSavingImage = false;
        downloadBtn.addEventListener('click', async () => {
            if (isSavingImage) return;
            
            if (!hasImage) {
                alert('กรุณาอัปโหลดรูปภาพก่อนทำการบันทึก');
                return;
            }

            if (!line1Input.value.trim() || !rahasInput.value.trim() || !line2Input.value.trim() || !line3Input.value.trim()) {
                alert('กรุณากรอกข้อมูลให้ครบถ้วนทุกช่องก่อนทำการบันทึก (ชื่อ-นามสกุล, รหัสนักศึกษา, โรงเรียน, และบริษัท)');
                return;
            }

            isSavingImage = true;
            const origHtml = downloadBtn.innerHTML;
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
            
            try {
                let studentId = '';
                let studentName = '';
                let roomVal = '';
                let yearVal = '';

                const line1Val = line1Input.value.trim();
                const rahasVal = rahasInput.value.trim();
                const line2Val = line2Input.value.trim();
                const line3Val = line3Input.value.trim();

                studentId = rahasVal.toUpperCase();
                studentName = line1Val;
                roomVal = line2Val;
                yearVal = line3Val;

                let dbStudentId = 'STD001';
                try {
                    const studentsList = await window.tuitionStore.getStudents();
                    if (studentsList && studentsList.length > 0) {
                        dbStudentId = studentsList[0].id;
                    }
                } catch (e) {
                    console.warn("Could not fetch students list for fallback ID:", e);
                }

                if (state.currentStudent) {
                    dbStudentId = state.currentStudent.id;
                }

                const canvas = document.createElement('canvas');
                canvas.width = 800;
                canvas.height = 1200;
                const ctx = canvas.getContext('2d');
                
                // 1. Draw white background over the entire canvas (800x1200)
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 800, 1200);
                
                // 2. Draw Student Image inside top box (0, 0, 800, 840) with clipping
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, 0, 800, 840);
                ctx.clip();
                
                // Scale parameters from preview wrapper width to canvas inner width (800px)
                const currentWrapperWidth = getWrapperWidth();
                const k = 800 / currentWrapperWidth;
                const canvasBaseWidth = baseWidth * k;
                const canvasBaseHeight = baseHeight * k;
                
                const drawWidth = canvasBaseWidth * scale;
                const drawHeight = canvasBaseHeight * scale;
                
                // Centered draw X and Y positions
                const drawX = (800 - drawWidth) / 2 + offsetX * k;
                const drawY = (840 - drawHeight) / 2 + offsetY * k;
                
                ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
                ctx.restore();
                
                // 3. Draw centered bold text in the white text box area (0, 840, 800, 360)
                ctx.fillStyle = '#000000';
                
                // Fonts: use Kanit with fallbacks (set font BEFORE text alignment to avoid mobile browser resets)
                ctx.font = 'bold 36px "Kanit", "Noto Sans Thai", "Sarabun", sans-serif';
                ctx.textAlign = 'left'; // Use left alignment and manually center to fix mobile device Thai font metrics bugs
                ctx.textBaseline = 'middle';
                
                const txtLine1 = `${line1Val} ${rahasVal}`;
                const txtLine2 = line2Val;
                const txtLine3 = line3Val;
                
                const m1 = ctx.measureText(txtLine1);
                const m2 = ctx.measureText(txtLine2);
                const m3 = ctx.measureText(txtLine3);
                
                // Line heights centered inside 360px area
                ctx.fillText(txtLine1, 400 - m1.width / 2, 940);
                ctx.fillText(txtLine2, 400 - m2.width / 2, 1020);
                ctx.fillText(txtLine3, 400 - m3.width / 2, 1100);
                
                const cardBase64 = canvas.toDataURL('image/png');
                
                // 4. Save to database
                const cardInfo = {
                    id: studentId,
                    name: studentName,
                    room: roomVal,
                    year: yearVal
                };
                const commentText = `CARD_INFO:${JSON.stringify(cardInfo)}`;
                await window.tuitionStore.saveIntroCard(dbStudentId, studentId, cardBase64, commentText);
                
                // 5. Show Success Checkmark Modal
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

                // 6. Sync and notify database update
                await notifyDbUpdate('payments', dbStudentId);

            } catch (err) {
                console.error("Save card error:", err);
                alert(`❌ เกิดข้อผิดพลาดในการบันทึกรูปภาพ: ${err.message || JSON.stringify(err)}`);
            } finally {
                isSavingImage = false;
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = origHtml;
            }
        });
        
        // Expose function to trigger default values
        window.populateImageToolDefaults = populateDefaults;
    }

});
