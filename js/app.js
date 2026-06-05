/**
 * Tuition Payment Portal - Main Application Logic
 * Integrates database persistence, slip conversion to PNG, drag-and-drop uploads,
 * automated slip generation, admin validation dashboard, and receipts.
 */

document.addEventListener('DOMContentLoaded', () => {
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
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    // First line: Class/ID/Room
                    ctx.fillStyle = '#86868b'; // Apple gray
                    ctx.font = `600 ${fontSize * 0.8}px 'Noto Sans Thai', sans-serif`;
                    ctx.fillText(stampName, W / 2, headerHeight * 0.35);
                    
                    // Second line: Name
                    ctx.fillStyle = '#1d1d1f'; // Apple black
                    ctx.font = `bold ${fontSize}px 'Noto Sans Thai', sans-serif`;
                    ctx.fillText(stampId, W / 2, headerHeight * 0.7);
                    
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
            }
            switchView(targetView);
        }

        const mobTabStudent = document.getElementById('mob-tab-student');
        const mobTabAdmin = document.getElementById('mob-tab-admin');
        if (mobTabStudent) {
            mobTabStudent.addEventListener('click', () => handleMobileNav('view-student-auth', 'mob-tab-student'));
        }
        if (mobTabAdmin) {
            mobTabAdmin.addEventListener('click', () => handleMobileNav('view-admin-auth', 'mob-tab-admin'));
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
    }

    // =========================================================================
    // STUDENT AUTHENTICATION & PROFILES
    // =========================================================================
    async function renderStudentMockGrid() {
        const grid = document.getElementById('mock-students-grid');
        // แสดงสถานะกำลังโหลดข้อมูล
        grid.innerHTML = '<div style="text-align: center; padding: 20px; color: #86868b; font-size: 14px;"><i class="fa-solid fa-circle-notch fa-spin"></i> กำลังโหลดข้อมูลจากระบบหลังบ้าน...</div>';
        
        const students = await window.tuitionStore.getStudents();
        grid.innerHTML = '';
        
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

    // --- STUDENT PIN AUTHENTICATION LOGIC ---
    let pendingStudentLogin = null;

    function openStudentPinModal(student) {
        pendingStudentLogin = student;
        document.getElementById('modal-student-pin').classList.add('active');
        document.getElementById('pin-error').style.display = 'none';
        
        // Clear all inputs
        const hiddenPin = document.getElementById('hidden-pin-input');
        if (hiddenPin) {
            hiddenPin.value = '';
            hiddenPin.dispatchEvent(new Event('input'));
        }
        
        // Focus input (only on desktop to prevent mobile keyboard animation conflict)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (!isMobile) {
            setTimeout(() => {
                if (hiddenPin) hiddenPin.focus();
            }, 100);
        }
    }

    function setupPinModal() {
        const modal = document.getElementById('modal-student-pin');
        const errorText = document.getElementById('pin-error');
        const hiddenPin = document.getElementById('hidden-pin-input');
        
        if (!modal || !hiddenPin) return;

        // Close modal when clicking outside the content (on the modal container itself)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                pendingStudentLogin = null;
            }
        });

        // Setup PIN inputs behavior
        const pinDisplays = [
            document.getElementById('pin1-display'),
            document.getElementById('pin2-display'),
            document.getElementById('pin3-display'),
            document.getElementById('pin4-display')
        ];

        hiddenPin.addEventListener('input', (e) => {
            // Ensure only numbers
            hiddenPin.value = hiddenPin.value.replace(/[^0-9]/g, '');
            const val = hiddenPin.value;
            
            // Update UI boxes
            pinDisplays.forEach((disp, i) => {
                disp.textContent = val[i] || '';
                if (i === val.length || (i === 3 && val.length === 4)) {
                    disp.classList.add('focused-box');
                } else {
                    disp.classList.remove('focused-box');
                }
            });
            
            errorText.style.display = 'none';

            if (val.length === 4) {
                verifyPin();
            }
        });

        function verifyPin() {
            if (!pendingStudentLogin) return;
            
            const enteredPin = hiddenPin.value;
            if (enteredPin.length !== 4) return;
            
            // Get last 4 digits of student ID
            const targetPin = pendingStudentLogin.id.slice(-4);
            
            if (enteredPin === targetPin) {
                modal.classList.remove('active');
                logInStudent(pendingStudentLogin);
                pendingStudentLogin = null;
            } else {
                // Wrong PIN
                errorText.style.display = 'block';
                // Add a small shake animation to pin inputs container
                const content = modal.querySelector('.pin-inputs');
                content.style.animation = 'shake 0.4s cubic-bezier(.36,.07,.19,.97) both';
                setTimeout(() => { content.style.animation = ''; }, 400);
                
                // Clear input and refocus
                hiddenPin.value = '';
                hiddenPin.dispatchEvent(new Event('input'));
                hiddenPin.focus();
            }
        }
    }


    // Handle avatar image upload with interactive crop and position adjustments
    function setupAvatarUpload() {
        const uploadInput = document.getElementById('avatar-upload');
        const avatarImg = document.getElementById('student-display-avatar');
        const cropModal = document.getElementById('modal-crop-profile');
        const cropImg = document.getElementById('crop-preview-img');
        const zoomRange = document.getElementById('crop-zoom-range');
        const btnCancelCrop = document.getElementById('btn-cancel-crop');
        const btnSaveCrop = document.getElementById('btn-save-crop');
        
        if (!uploadInput || !avatarImg || !cropModal || !cropImg || !zoomRange || !btnCancelCrop || !btnSaveCrop) return;

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
            
            zoomRange.value = 1;
            
            updatePreviewTransform();
        };

        function updatePreviewTransform() {
            // Clamping bounds to prevent transparent areas showing:
            const viewportSize = 280;
            const wRendered = fitW * currentZoom;
            const hRendered = fitH * currentZoom;
            
            const minX = viewportSize - wRendered;
            const minY = viewportSize - hRendered;
            const maxX = 0;
            const maxY = 0;

            if (currentX < minX) currentX = minX;
            if (currentX > maxX) currentX = maxX;
            if (currentY < minY) currentY = minY;
            if (currentY > maxY) currentY = maxY;

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

        // Touch listeners
        cropImg.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                startDrag(e.touches[0].clientX, e.touches[0].clientY);
            }
        });

        window.addEventListener('touchmove', (e) => {
            if (isDragging && e.touches.length === 1) {
                moveDrag(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });

        window.addEventListener('touchend', stopDrag);

        // Zoom range change
        zoomRange.addEventListener('input', () => {
            const oldZoom = currentZoom;
            currentZoom = parseFloat(zoomRange.value);
            
            // Zoom relative to viewport center (140, 140)
            const cx = 140;
            const cy = 140;
            
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
                const base64Str = canvas.toDataURL('image/jpeg', 0.9);
                
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
            const slipPayments = payments.filter(p => p.slipImage);

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

                // Re-render mock profile status list and switch view
                renderStudentMockGrid();
                switchView('view-student-auth');
            });
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

        // Update Student View Info
        document.getElementById('student-display-name').textContent = cleanName;
        document.getElementById('student-display-meta').textContent = `รหัส: ${student.id} • ห้อง ${student.room} • ${fundingText}`;
        
        const avatarImg = document.getElementById('student-display-avatar');
        if (avatarImg) {
            avatarImg.src = student.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=e2e8f0';
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

        const payments = await window.tuitionStore.getPaymentsByStudentId(state.currentStudent.id, true);
        
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
            const origHtml = submitBtn.innerHTML;
            
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
                
                alert("🎉 ส่งหลักฐานการชำระเงินเรียบร้อยแล้ว! กรุณารอเจ้าหน้าที่ตรวจสอบสลิป");
            } catch (err) {
                console.error("Payment submission error:", err);
                alert(`❌ เกิดข้อผิดพลาดในการส่งสลิป: ${err.message || err.description || JSON.stringify(err)}`);
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = origHtml;
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
        
        // Show all items without filtering
        const filtered = payments.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

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
        img.style.transform = `scale(${state.zoomLevel}) rotate(${state.rotationAngle}deg)`;
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


});
