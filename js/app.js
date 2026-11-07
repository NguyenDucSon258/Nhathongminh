/**
 * =============================================================================
 * HỆ THỐNG NHÀ THÔNG MINH v1 - CORE JAVASCRIPT APPLICATION (app.js)
 * Quản lý trạng thái, API điều khiển, Web Audio, Mock Data và đồng bộ các trang
 * =============================================================================
 */

const AppCore = {
    // Trạng thái ứng dụng
    state: {
        isMockMode: false, // Mặc định tắt giả lập để nhận dữ liệu từ cảm biến phần cứng qua Firebase
        isConnected: true,
        deviceHost: "192.168.1.50",
        pollingIntervalMs: 2000,
        
        // Dữ liệu cảm biến: Khởi tạo rỗng (null), chờ vi xử lý phần cứng gửi qua Firebase
        sensors: {
            temp: null,
            hum: null,
            tempMin: null,
            tempMax: null,
            gasLiving: null,
            gasKitchen: null,
            pirMotion: null,
            isRaining: null,
            rainIntensity: null
        },

        // Trạng thái thiết bị
        devices: {
            doorLocked: true,
            lightLiving: false,
            lightKitchen: false,
            fanKitchen: false,
            lightBedroom: false,
            alarmActive: false,
            rackMode: 'auto',
            rackPosition: 'extended'
        },

        // Ngưỡng cảnh báo
        thresholds: {
            gasDangerPpm: 400,
            gasWarningPpm: 280,
            tempHighC: 35.0
        },

        // Người dùng hiện tại và danh sách thành viên gia đình (Cloud Firestore)
        currentUser: {
            id: "admin_default",
            name: "Nguyễn Văn An",
            role: "admin",
            relationship: "Chủ hộ / Bố",
            avatarColor: "#2563eb",
            can_unlock_door: true,
            can_trigger_alarm: true
        },
        familyMembers: [
            { id: "1", name: "Nguyễn Văn An", role: "admin", relationship: "Chủ hộ / Bố", phone: "0912 345 678", status: "online", avatarColor: "#2563eb", can_unlock_door: true, can_trigger_alarm: true, lastActive: "Đang hoạt động" },
            { id: "2", name: "Trần Thị Mai", role: "user", relationship: "Vợ / Mẹ", phone: "0987 654 321", status: "online", avatarColor: "#ec4899", can_unlock_door: true, can_trigger_alarm: false, lastActive: "5 phút trước" },
            { id: "3", name: "Nguyễn Minh Khôi", role: "user", relationship: "Con trai", phone: "0901 234 567", status: "offline", avatarColor: "#10b981", can_unlock_door: true, can_trigger_alarm: false, lastActive: "Hôm qua 21:30" }
        ],

        // Thông tin người dùng thao tác gần nhất (Đồng bộ Firebase Realtime Database)
        lastOperator: {
            ten: "Nguyễn Văn An",
            vai_tro: "admin",
            thiet_bi: "Hệ Thống",
            thao_tac: "SẴN SÀNG",
            thoi_gian: "Hôm nay"
        },

        // Danh sách các phòng / Node được thêm động từ giao diện hoặc nhận diện tự động từ Firebase
        customRooms: []
    },

    pollingTimer: null,
    audioContext: null,
    sirenOscillator: null,
    isSirenPlaying: false,

    /**
     * Khởi động ứng dụng
     */
    init: async function() {
        console.log("🚀 [SmartHome App] Đang khởi động hệ thống...");

        // 0. Khởi tạo theme nền giao diện (Mặc định: Biệt Thự Thông Minh nhìn rõ hậu cảnh)
        this.initTheme();

        // 1. Phục hồi state & User từ localStorage nếu đã có
        this.loadStateFromStorage();
        this.loadCustomRooms();
        const savedUser = localStorage.getItem('smarthome_current_user');
        if (savedUser) {
            try { this.state.currentUser = JSON.parse(savedUser); } catch(e) {}
        }

        // 2. Thử nạp cấu hình ban đầu từ data/data.json
        await this.loadInitialJsonConfig();

        // 3. Khởi tạo Firebase nếu được kích hoạt
        if (window.SmartHomeFirebase) {
            window.SmartHomeFirebase.init((firebaseSensors) => {
                this.handleFirebaseSensorUpdate(firebaseSensors);
            });

            // Lắng nghe các thao tác bấm nút lưu trên Cloud Firestore
            if (typeof window.SmartHomeFirebase.listenToFirestoreDeviceLogs === 'function') {
                window.SmartHomeFirebase.listenToFirestoreDeviceLogs((firestoreLogs) => {
                    if (firestoreLogs && firestoreLogs.length > 0) {
                        const topLog = firestoreLogs[0];
                        if (topLog && topLog.message) {
                            this.addLog(`[Cloud Firestore] ${topLog.message}`, 'cmd');
                        }
                    }
                });
            }
        }

        // 4. Đồng hồ thời gian thực
        this.startClock();

        // 5. Khởi động vòng lặp Polling
        this.startPolling();

        // 6. Lắng nghe storage event để đồng bộ dữ liệu giữa các tab/trang HTML
        window.addEventListener('storage', (e) => {
            if (e.key === 'smarthome_state_v1') {
                this.loadStateFromStorage();
                this.renderCurrentPage();
            }
            if (e.key === 'smarthome_custom_rooms') {
                this.loadCustomRooms();
                this.renderCustomRooms();
            }
        });

        // 7. Render giao diện trang hiện tại
        this.renderCurrentPage();

        // 8. Đăng ký mở khóa Web Audio Policy khi người dùng tương tác
        const unlockAudio = () => {
            this.initAudioContext();
            window.removeEventListener('click', unlockAudio);
        };
        window.addEventListener('click', unlockAudio);

        this.addLog("Hệ thống Nhà Thông Minh v1 đã sẵn sàng hoạt động.", "cmd");
    },

    /**
     * Nạp dữ liệu cấu hình từ file data/data.json
     */
    loadInitialJsonConfig: async function() {
        try {
            const res = await fetch('data/data.json');
            if (res.ok) {
                const jsonData = await res.json();
                console.log("✅ [JSON] Đã nạp thành công data/data.json");
                // Cập nhật cấu hình mạng
                if (jsonData.network_config) {
                    this.state.deviceHost = jsonData.network_config.default_host;
                    this.state.isMockMode = jsonData.network_config.mock_mode || false;
                }
                // Các thông số cảm biến để rỗng (null), chờ vi xử lý gửi lên
                this.saveStateToStorage();
            }
        } catch (e) {
            console.warn("⚠️ [JSON] Chạy trực tiếp từ file:// (CORS hạn chế fetch JSON cục bộ), sử dụng dữ liệu mặc định.");
        }
    },

    /**
     * Lưu trạng thái vào localStorage để đồng bộ giữa các file HTML
     */
    saveStateToStorage: function() {
        try {
            localStorage.setItem('smarthome_state_v1', JSON.stringify({
                devices: this.state.devices,
                isMockMode: this.state.isMockMode,
                deviceHost: this.state.deviceHost
            }));
        } catch (e) {}
    },

    /**
     * Đọc trạng thái từ localStorage
     */
    loadStateFromStorage: function() {
        try {
            const raw = localStorage.getItem('smarthome_state_v1');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.devices) this.state.devices = { ...this.state.devices, ...parsed.devices };
                if (parsed.isMockMode !== undefined) this.state.isMockMode = parsed.isMockMode;
                if (parsed.deviceHost) this.state.deviceHost = parsed.deviceHost;
            }
        } catch (e) {}
    },

    /**
     * Xử lý dữ liệu cảm biến cập nhật từ Firebase
     * Nhận dữ liệu thực tế do phần cứng vi xử lý gửi qua Firebase
     */
    handleFirebaseSensorUpdate: function(data) {
        if (!data) return;
        // Cảm biến: Cập nhật giá trị thực tế do phần cứng gửi lên (nếu rỗng/chưa có thì giữ null)
        if (data.temp !== undefined) {
            this.state.sensors.temp = (data.temp !== null && data.temp !== "" && !isNaN(data.temp)) ? parseFloat(data.temp) : null;
        }
        if (data.hum !== undefined) {
            this.state.sensors.hum = (data.hum !== null && data.hum !== "" && !isNaN(data.hum)) ? parseFloat(data.hum) : null;
        }
        if (data.gasLiving !== undefined) {
            this.state.sensors.gasLiving = (data.gasLiving !== null && data.gasLiving !== "" && !isNaN(data.gasLiving)) ? parseInt(data.gasLiving) : null;
        }
        if (data.gasKitchen !== undefined) {
            this.state.sensors.gasKitchen = (data.gasKitchen !== null && data.gasKitchen !== "" && !isNaN(data.gasKitchen)) ? parseInt(data.gasKitchen) : null;
        }
        if (data.pirMotion !== undefined) {
            this.state.sensors.pirMotion = (data.pirMotion !== null && data.pirMotion !== "") ? Boolean(data.pirMotion) : null;
        }
        if (data.isRaining !== undefined) {
            this.state.sensors.isRaining = (data.isRaining !== null && data.isRaining !== "") ? Boolean(data.isRaining) : null;
        }

        // Thiết bị
        if (data.doorLocked !== undefined) this.state.devices.doorLocked = Boolean(data.doorLocked);
        if (data.lightLiving !== undefined) this.state.devices.lightLiving = Boolean(data.lightLiving);
        if (data.lightKitchen !== undefined) this.state.devices.lightKitchen = Boolean(data.lightKitchen);
        if (data.fanKitchen !== undefined) this.state.devices.fanKitchen = Boolean(data.fanKitchen);
        if (data.lightBedroom !== undefined) this.state.devices.lightBedroom = Boolean(data.lightBedroom);
        if (data.alarmActive !== undefined) this.state.devices.alarmActive = Boolean(data.alarmActive);
        if (data.rackMode !== undefined) this.state.devices.rackMode = data.rackMode;
        if (data.rackPosition !== undefined) this.state.devices.rackPosition = data.rackPosition;
        
        // Cập nhật các Node / Phòng phần cứng mở rộng từ Firebase
        if (data.nodes) {
            this.handleCustomNodesUpdate(data.nodes);
        }
        if (data.roomsConfig && (!this.state.customRooms || this.state.customRooms.length === 0)) {
            const loaded = Array.isArray(data.roomsConfig) ? data.roomsConfig : Object.values(data.roomsConfig);
            if (loaded.length > 0) {
                this.state.customRooms = loaded;
                this.saveCustomRoomsToStorageOnly();
            }
        }

        this.saveStateToStorage();
        this.renderCurrentPage();
        this.setConnectionStatus(true, 'online');
    },

    /**
     * Cập nhật thông tin Người dùng thực hiện thao tác gần nhất (Được gửi từ Firebase Realtime Database)
     */
    updateLastOperatorUI: function(info) {
        if (!info || !info.ten) return;
        this.state.lastOperator = info;

        // Cập nhật lên widget hiển thị trên Dashboard (nếu có phần tử trong DOM)
        const nameEl = document.getElementById('lastOperatorName');
        const actEl = document.getElementById('lastOperatorAction');
        const timeEl = document.getElementById('lastOperatorTime');
        const avatarEl = document.getElementById('lastOperatorAvatar');

        if (nameEl) nameEl.innerText = `${info.ten} (${info.vai_tro === 'admin' ? 'Admin' : 'Thành viên'})`;
        if (actEl) actEl.innerText = `Đã ${info.thao_tac} ${info.thiet_bi}`;
        if (timeEl) timeEl.innerText = info.thoi_gian || '';
        if (avatarEl) {
            avatarEl.innerText = info.ten.charAt(0).toUpperCase();
            avatarEl.style.background = (info.vai_tro === 'admin') ? 'var(--accent-primary)' : '#059669';
        }
    },

    /**
     * Gửi lệnh điều khiển phần cứng / Firebase / Mock
     */
    sendCommand: async function(deviceId, action, extra = {}) {
        this.addLog(`Lệnh gửi: [${deviceId}] -> ${action}`, 'cmd');

        // 1. Cập nhật state nội bộ
        this.applyDeviceState(deviceId, action, extra);
        this.saveStateToStorage();
        this.renderCurrentPage();

        // 2. Nếu có Firebase, đồng bộ ngay lên đám mây Realtime Database
        if (window.SmartHomeFirebase && window.SmartHomeFirebase.isFirebaseEnabled) {
            await window.SmartHomeFirebase.sendDeviceCommand(deviceId, action, extra);
            this.showToast(`🔥 Đã gửi lệnh [${deviceId}: ${action}] lên Firebase!`, 'success');
            return { success: true, mode: 'firebase' };
        }

        // 3. Nếu đang ở Mock Mode, hoàn thành lệnh giả lập
        if (this.state.isMockMode) {
            this.showToast(`Đã thực thi (Mô phỏng): ${deviceId} -> ${action}`, 'success');
            return { success: true, mode: 'mock' };
        }

        // 4. Nếu kết nối phần cứng thực tế qua HTTP REST API (ESP32)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);

            const res = await fetch(`http://${this.state.deviceHost}/api/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device: deviceId, action: action, timestamp: Date.now(), ...extra }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            if (res.ok) {
                this.showToast(`Thiết bị xác nhận: ${deviceId} ${action}`, 'success');
                this.setConnectionStatus(true, 'online');
            } else {
                throw new Error(`HTTP Error ${res.status}`);
            }
        } catch (err) {
            console.error("Lỗi phần cứng:", err);
            this.showToast(`Lỗi kết nối tới ${this.state.deviceHost}!`, 'error');
            this.setConnectionStatus(false, 'offline');
        }
    },

    /**
     * Cập nhật trạng thái thiết bị trong bộ nhớ
     */
    applyDeviceState: function(deviceId, action, extra) {
        switch(deviceId) {
            case 'door':
                this.state.devices.doorLocked = (action === 'lock');
                break;
            case 'light_living':
                this.state.devices.lightLiving = (action === 'on');
                break;
            case 'light_kitchen':
                this.state.devices.lightKitchen = (action === 'on');
                break;
            case 'fan_kitchen':
                this.state.devices.fanKitchen = (action === 'on');
                break;
            case 'light_bedroom':
                this.state.devices.lightBedroom = (action === 'on');
                break;
            case 'alarm':
                this.state.devices.alarmActive = (action === 'on');
                break;
            case 'rack_mode':
                this.state.devices.rackMode = action; // 'auto' | 'manual'
                break;
            case 'rack':
                this.state.devices.rackPosition = (action === 'extend') ? 'extended' : 'retracted';
                break;
        }
    },

    /**
     * Vòng lặp Polling lấy dữ liệu
     */
    startPolling: function() {
        if (this.pollingTimer) clearInterval(this.pollingTimer);
        this.pollingTimer = setInterval(() => {
            this.tickDataUpdate();
        }, this.state.pollingIntervalMs);
    },

    tickDataUpdate: async function() {
        // Chỉ giả lập số liệu nếu người dùng chủ động BẬT chế độ Mock Mode
        if (this.state.isMockMode) {
            if (this.state.sensors.temp === null) this.state.sensors.temp = 28.5;
            if (this.state.sensors.hum === null) this.state.sensors.hum = 68;
            if (this.state.sensors.gasLiving === null) this.state.sensors.gasLiving = 120;
            if (this.state.sensors.gasKitchen === null) this.state.sensors.gasKitchen = 165;
            if (this.state.sensors.pirMotion === null) this.state.sensors.pirMotion = false;
            if (this.state.sensors.isRaining === null) this.state.sensors.isRaining = false;

            const tempDelta = (Math.random() - 0.5) * 0.3;
            this.state.sensors.temp = Math.min(33.0, Math.max(24.5, +(this.state.sensors.temp + tempDelta).toFixed(1)));

            const humDelta = (Math.random() - 0.5) * 0.6;
            this.state.sensors.hum = Math.min(85, Math.max(58, +(this.state.sensors.hum + humDelta).toFixed(0)));

            // Gas dao động nhẹ nếu không có báo động
            if (this.state.sensors.gasLiving < this.state.thresholds.gasDangerPpm) {
                this.state.sensors.gasLiving = Math.max(90, Math.min(220, this.state.sensors.gasLiving + Math.floor((Math.random() - 0.5) * 8)));
            }
            if (this.state.sensors.gasKitchen < this.state.thresholds.gasDangerPpm) {
                this.state.sensors.gasKitchen = Math.max(110, Math.min(240, this.state.sensors.gasKitchen + Math.floor((Math.random() - 0.5) * 10)));
            }

            // Tự động thu giàn phơi khi có mưa ở chế độ Auto
            if (this.state.devices.rackMode === 'auto' && this.state.sensors.isRaining) {
                if (this.state.devices.rackPosition !== 'retracted') {
                    this.state.devices.rackPosition = 'retracted';
                    this.addLog("Tự động: Trời mưa -> Đã thu giàn phơi vào!", 'warn');
                    this.showToast("Cảm biến mưa: Đã tự động thu giàn phơi vào!", 'warn');
                }
            }

            this.saveStateToStorage();
            this.renderCurrentPage();
            return;
        }

        // Khi kết nối với Firebase Realtime Database: Firebase tự động push realtime qua listener on('value'), không cần polling
        if (window.SmartHomeFirebase && window.SmartHomeFirebase.isConnected) {
            return;
        }

        // Lấy dữ liệu qua REST API khi kết nối thực tế
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1800);
            const res = await fetch(`http://${this.state.deviceHost}/api/sensors`, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (data.temp !== undefined) this.state.sensors.temp = parseFloat(data.temp);
                if (data.hum !== undefined) this.state.sensors.hum = parseFloat(data.hum);
                if (data.gasLiving !== undefined) this.state.sensors.gasLiving = parseInt(data.gasLiving);
                if (data.gasKitchen !== undefined) this.state.sensors.gasKitchen = parseInt(data.gasKitchen);
                if (data.pir !== undefined) this.state.sensors.pirMotion = Boolean(data.pir);
                if (data.rain !== undefined) this.state.sensors.isRaining = Boolean(data.rain);
                if (data.doorLocked !== undefined) this.state.devices.doorLocked = Boolean(data.doorLocked);
                if (data.rackPos !== undefined) this.state.devices.rackPosition = data.rackPos;

                this.setConnectionStatus(true, 'online');
                this.saveStateToStorage();
                this.renderCurrentPage();
            } else {
                this.setConnectionStatus(false, 'offline');
            }
        } catch (e) {
            this.setConnectionStatus(false, 'offline');
        }
    },

    /**
     * Render trang hiện tại dựa vào các phần tử DOM có mặt trên trang
     */
    renderCurrentPage: function() {
        // Cập nhật trạng thái báo động toàn hệ thống
        this.renderGlobalAlarmStatus();

        // Cập nhật thông tin User trên Header
        this.renderHeaderUserBadge();

        // 1. Nếu đang ở index.html (Tổng quan)
        if (document.getElementById('overviewPageMarker')) {
            this.renderOverviewPage();
        }

        // 2. Nếu đang ở livingroom.html (Phòng khách)
        if (document.getElementById('livingRoomPageMarker')) {
            this.renderLivingRoomPage();
        }

        // 3. Nếu đang ở environment.html (Nhiệt độ & Độ ẩm)
        if (document.getElementById('environmentPageMarker')) {
            this.renderEnvironmentPage();
        }

        // 4. Nếu đang ở users.html (Quản lý Thành viên Gia Đình)
        if (document.getElementById('usersPageMarker')) {
            this.renderUsersPage();
        }
    },

    /**
     * Báo động chung & Còi hú Web Audio
     */
    renderGlobalAlarmStatus: function() {
        const isGasLivingDanger = (this.state.sensors.gasLiving !== null) && (this.state.sensors.gasLiving >= this.state.thresholds.gasDangerPpm);
        const isGasKitchenDanger = (this.state.sensors.gasKitchen !== null) && (this.state.sensors.gasKitchen >= this.state.thresholds.gasDangerPpm);
        const isHazard = isGasLivingDanger || isGasKitchenDanger || this.state.devices.alarmActive;

        const banner = document.getElementById('globalAlertBanner');
        const bannerTitle = document.getElementById('globalAlertTitle');
        const bannerDesc = document.getElementById('globalAlertDesc');

        if (banner) {
            if (isHazard) {
                banner.classList.add('active');
                if (isGasLivingDanger || isGasKitchenDanger) {
                    if (bannerTitle) bannerTitle.innerText = "CẢNH BÁO RÒ RỈ KHÍ GAS NGUY HIỂM!";
                    if (bannerDesc) bannerDesc.innerText = `Phát hiện nồng độ khí gas vượt ngưỡng (>400 PPM). Bếp: ${this.state.sensors.gasKitchen || 0} PPM, Khách: ${this.state.sensors.gasLiving || 0} PPM.`;
                } else {
                    if (bannerTitle) bannerTitle.innerText = "BÁO ĐỘNG SỰ CỐ KHẨN CẤP ĐANG BẬT!";
                    if (bannerDesc) bannerDesc.innerText = "Hệ thống còi báo động khẩn cấp đang được kích hoạt từ phòng ngủ.";
                }
                this.startSiren();
            } else {
                banner.classList.remove('active');
                this.stopSiren();
            }
        }
    },

    /**
     * Render cho Trang Chủ (index.html)
     */
    renderOverviewPage: function() {
        // Nhiệt độ & Độ ẩm tóm tắt (chờ phần cứng hoặc hiển thị số đo thực tế)
        const elTemp = document.getElementById('ovTemp');
        const elHum = document.getElementById('ovHum');
        const hasTemp = (this.state.sensors.temp !== null && this.state.sensors.temp !== undefined && !isNaN(this.state.sensors.temp));
        const hasHum = (this.state.sensors.hum !== null && this.state.sensors.hum !== undefined && !isNaN(this.state.sensors.hum));

        if (elTemp) elTemp.innerText = hasTemp ? Number(this.state.sensors.temp).toFixed(1) : "--";
        if (elHum) elHum.innerText = hasHum ? this.state.sensors.hum : "--";

        // Donut Độ ẩm
        const donutCircle = document.getElementById('ovHumDonutCircle');
        if (donutCircle) {
            const circumference = 2 * Math.PI * 40; // r=40 => ~251.3
            const humVal = hasHum ? this.state.sensors.hum : 0;
            const offset = circumference - (humVal / 100) * circumference;
            donutCircle.style.strokeDasharray = circumference;
            donutCircle.style.strokeDashoffset = offset;
        }

        // Cửa chính
        const elDoorState = document.getElementById('ovDoorState');
        const btnDoor = document.getElementById('ovBtnDoor');
        if (elDoorState) {
            elDoorState.innerText = this.state.devices.doorLocked ? "Đang Đóng (Khóa)" : "Đang Mở (Servo 90°)";
            elDoorState.style.color = this.state.devices.doorLocked ? "var(--text-muted)" : "var(--accent-green)";
        }
        if (btnDoor) {
            btnDoor.innerText = this.state.devices.doorLocked ? "Mở Khóa (90°)" : "Khóa Cửa (0°)";
        }

        // Đèn phòng khách
        const swLightLiving = document.getElementById('ovSwitchLightLiving');
        if (swLightLiving) swLightLiving.checked = this.state.devices.lightLiving;

        // Đèn phòng bếp
        const swLightKitchen = document.getElementById('ovSwitchLightKitchen');
        if (swLightKitchen) swLightKitchen.checked = this.state.devices.lightKitchen;

        // Quạt bếp
        const swFanKitchen = document.getElementById('ovSwitchFanKitchen');
        if (swFanKitchen) swFanKitchen.checked = this.state.devices.fanKitchen;

        // Đèn phòng ngủ
        const swLightBedroom = document.getElementById('ovSwitchLightBedroom');
        if (swLightBedroom) swLightBedroom.checked = this.state.devices.lightBedroom;

        // Gas Bếp
        const elGasKitchen = document.getElementById('ovGasKitchen');
        const elBarGasKitchen = document.getElementById('ovBarGasKitchen');
        const hasGasKitchen = (this.state.sensors.gasKitchen !== null && this.state.sensors.gasKitchen !== undefined);
        if (elGasKitchen) {
            elGasKitchen.innerText = hasGasKitchen ? `${this.state.sensors.gasKitchen} PPM` : "Chờ dữ liệu...";
            elGasKitchen.style.color = (hasGasKitchen && this.state.sensors.gasKitchen >= this.state.thresholds.gasDangerPpm) ? 'var(--accent-red)' : 'var(--accent-green)';
        }
        if (elBarGasKitchen) {
            const percent = hasGasKitchen ? Math.min(100, (this.state.sensors.gasKitchen / 700) * 100) : 0;
            elBarGasKitchen.style.width = percent + '%';
            elBarGasKitchen.style.background = (hasGasKitchen && this.state.sensors.gasKitchen >= this.state.thresholds.gasDangerPpm) ? 'var(--accent-red)' : 'var(--accent-green)';
        }

        // Thời tiết & Giàn phơi
        const elWeather = document.getElementById('ovWeatherStatus');
        const elRack = document.getElementById('ovRackStatus');
        if (elWeather) {
            if (this.state.sensors.isRaining === null) {
                elWeather.innerText = "⏳ Chờ cảm biến mưa...";
                elWeather.style.color = "var(--text-muted)";
            } else if (this.state.sensors.isRaining) {
                elWeather.innerText = "🌧️ Đang có mưa";
                elWeather.style.color = "var(--accent-blue)";
            } else {
                elWeather.innerText = "☀️ Khô ráo / Hửng nắng";
                elWeather.style.color = "var(--accent-amber)";
            }
        }
        if (elRack) {
            elRack.innerText = (this.state.devices.rackPosition === 'extended') ? "Đang vươn ra (Phơi)" : "Đã thu vào an toàn";
            elRack.style.color = (this.state.devices.rackPosition === 'extended') ? "var(--accent-green)" : "var(--accent-indigo)";
        }

        // Nút khẩn cấp
        const btnAlarm = document.getElementById('ovBtnAlarm');
        if (btnAlarm) {
            btnAlarm.innerText = this.state.devices.alarmActive ? "TẮT BÁO ĐỘNG" : "BẬT CÒI KHẨN CẤP";
            if (this.state.devices.alarmActive) btnAlarm.classList.add('active');
            else btnAlarm.classList.remove('active');
        }

        // Render danh sách các phòng / Node mở rộng
        this.renderCustomRooms();
    },

    /**
     * Render cho Trang Phòng Khách (livingroom.html)
     */
    renderLivingRoomPage: function() {
        // Cửa chính
        const lrDoorText = document.getElementById('lrDoorText');
        const lrDoorIcon = document.getElementById('lrDoorIcon');
        const lrBtnDoor = document.getElementById('lrBtnDoor');
        if (lrDoorText) {
            lrDoorText.innerText = this.state.devices.doorLocked ? "Đang Đóng (Khóa Cửa 0°)" : "Đang Mở Khóa (Servo 90°)";
            lrDoorText.className = this.state.devices.doorLocked ? "meta-val" : "meta-val text-green";
        }
        if (lrDoorIcon) {
            if (this.state.devices.doorLocked) lrDoorIcon.classList.remove('on');
            else lrDoorIcon.classList.add('on');
        }
        if (lrBtnDoor) {
            lrBtnDoor.innerText = this.state.devices.doorLocked ? "Mở Khóa Cửa (Servo 90°)" : "Khóa Cửa Lại (Servo 0°)";
        }

        // Đèn phòng khách
        const swLight = document.getElementById('lrSwitchLight');
        const iconLight = document.getElementById('lrIconLight');
        if (swLight) swLight.checked = this.state.devices.lightLiving;
        if (iconLight) {
            if (this.state.devices.lightLiving) iconLight.classList.add('on');
            else iconLight.classList.remove('on');
        }

        // Cảm biến PIR
        const lrPirBadge = document.getElementById('lrPirBadge');
        const lrPirText = document.getElementById('lrPirText');
        if (lrPirBadge && lrPirText) {
            if (this.state.sensors.pirMotion === null) {
                lrPirBadge.className = "status-pill";
                lrPirText.innerText = "Chờ cảm biến PIR...";
            } else if (this.state.sensors.pirMotion) {
                lrPirBadge.className = "status-pill mock";
                lrPirText.innerText = "Phát hiện có người di chuyển!";
            } else {
                lrPirBadge.className = "status-pill";
                lrPirText.innerText = "Khu vực trống (Không có người)";
            }
        }

        // Cảm biến Gas MQ2 Phòng Khách
        const lrGasPpm = document.getElementById('lrGasPpm');
        const lrGasPpmText = document.getElementById('lrGasPpmText');
        const lrGasBadge = document.getElementById('lrGasBadge');
        const lrGasDonut = document.getElementById('lrGasDonut');
        const hasGasLiving = (this.state.sensors.gasLiving !== null && this.state.sensors.gasLiving !== undefined);

        if (lrGasPpm) lrGasPpm.innerText = hasGasLiving ? this.state.sensors.gasLiving : "--";
        if (lrGasPpmText) lrGasPpmText.innerText = hasGasLiving ? this.state.sensors.gasLiving : "--";
        if (lrGasBadge) {
            if (!hasGasLiving) {
                lrGasBadge.innerText = "CHỜ CẢM BIẾN";
                lrGasBadge.className = "status-pill";
            } else {
                const isDanger = this.state.sensors.gasLiving >= this.state.thresholds.gasDangerPpm;
                lrGasBadge.innerText = isDanger ? "NGUY HIỂM RÒ RỈ!" : "AN TOÀN";
                lrGasBadge.className = isDanger ? "status-pill offline" : "status-pill online";
            }
        }
        if (lrGasDonut) {
            const circumference = 2 * Math.PI * 40;
            const percent = hasGasLiving ? Math.min(100, (this.state.sensors.gasLiving / 600) * 100) : 0;
            lrGasDonut.style.strokeDashoffset = circumference - (percent / 100) * circumference;
            lrGasDonut.style.stroke = (hasGasLiving && this.state.sensors.gasLiving >= this.state.thresholds.gasDangerPpm) ? "var(--accent-red)" : "var(--accent-primary)";
        }
    },

    /**
     * Render cho Trang Môi Trường (environment.html)
     */
    renderEnvironmentPage: function() {
        const envTemp = document.getElementById('envTemp');
        const envHum = document.getElementById('envHum');
        const envTempMin = document.getElementById('envTempMin');
        const envTempMax = document.getElementById('envTempMax');
        const envComfort = document.getElementById('envComfort');

        const hasTemp = (this.state.sensors.temp !== null && this.state.sensors.temp !== undefined && !isNaN(this.state.sensors.temp));
        const hasHum = (this.state.sensors.hum !== null && this.state.sensors.hum !== undefined && !isNaN(this.state.sensors.hum));

        if (envTemp) envTemp.innerText = hasTemp ? Number(this.state.sensors.temp).toFixed(1) : "--";
        if (envHum) envHum.innerText = hasHum ? this.state.sensors.hum : "--";
        if (envTempMin) envTempMin.innerText = (this.state.sensors.tempMin !== null && this.state.sensors.tempMin !== undefined) ? `${this.state.sensors.tempMin}°C` : "--";
        if (envTempMax) envTempMax.innerText = (this.state.sensors.tempMax !== null && this.state.sensors.tempMax !== undefined) ? `${this.state.sensors.tempMax}°C` : "--";

        if (envComfort) {
            if (!hasTemp || !hasHum) {
                envComfort.innerText = "Chờ phần cứng gửi dữ liệu...";
                envComfort.style.color = "var(--text-muted)";
            } else {
                const t = this.state.sensors.temp;
                const h = this.state.sensors.hum;
                if (t >= 24 && t <= 29 && h >= 50 && h <= 70) {
                    envComfort.innerText = "Lý Tưởng (Comfortable)";
                    envComfort.style.color = "var(--accent-green)";
                } else if (t > 32) {
                    envComfort.innerText = "Khá Nóng (Hot Alert)";
                    envComfort.style.color = "var(--accent-red)";
                } else {
                    envComfort.innerText = "Bình Thường (Normal)";
                    envComfort.style.color = "var(--accent-primary)";
                }
            }
        }

        // Cập nhật biểu đồ cột mô phỏng độ ẩm
        const barHum = document.getElementById('envBarHum');
        if (barHum) barHum.style.height = hasHum ? `${this.state.sensors.hum}%` : '0%';
    },

    /**
     * Web Audio API: Còi hú báo động
     */
    initAudioContext: function() {
        if (!this.audioContext) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this.audioContext = new AudioCtx();
        }
    },

    startSiren: function() {
        try {
            this.initAudioContext();
            if (!this.audioContext || this.isSirenPlaying) return;
            if (this.audioContext.state === 'suspended') this.audioContext.resume();

            this.sirenOscillator = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();

            this.sirenOscillator.type = 'sawtooth';
            const now = this.audioContext.currentTime;
            this.sirenOscillator.frequency.setValueAtTime(600, now);

            for (let i = 0; i < 40; i++) {
                this.sirenOscillator.frequency.linearRampToValueAtTime(1200, now + (i * 0.8) + 0.4);
                this.sirenOscillator.frequency.linearRampToValueAtTime(600, now + (i * 0.8) + 0.8);
            }

            gain.gain.setValueAtTime(0.12, now);
            this.sirenOscillator.connect(gain);
            gain.connect(this.audioContext.destination);

            this.sirenOscillator.start();
            this.isSirenPlaying = true;
        } catch (e) {}
    },

    stopSiren: function() {
        if (this.isSirenPlaying && this.sirenOscillator) {
            try {
                this.sirenOscillator.stop();
                this.sirenOscillator.disconnect();
            } catch (e) {}
            this.isSirenPlaying = false;
            this.sirenOscillator = null;
        }
    },

    silenceAlarm: function() {
        this.sendCommand('alarm', 'off');
        if (this.state.sensors.gasLiving >= this.state.thresholds.gasDangerPpm) {
            this.state.sensors.gasLiving = 150;
        }
        if (this.state.sensors.gasKitchen >= this.state.thresholds.gasDangerPpm) {
            this.state.sensors.gasKitchen = 180;
        }
        this.stopSiren();
        this.saveStateToStorage();
        this.renderCurrentPage();
        this.showToast("Đã tắt còi báo động khẩn cấp!", "warn");
    },

    /**
     * Quản lý kết nối & Toggle chế độ
     */
    toggleMockMode: function() {
        this.state.isMockMode = !this.state.isMockMode;
        this.saveStateToStorage();
        this.updateMockUI();
        if (this.state.isMockMode) {
            this.setConnectionStatus(true, 'mock');
            this.showToast("Đã BẬT chế độ dữ liệu giả lập (Simulation)", "warn");
        } else {
            this.setConnectionStatus(false, 'offline');
            this.showToast("Đã TẮT giả lập. Đang kết nối thiết bị...", "info");
        }
    },

    updateMockUI: function() {
        const btn = document.getElementById('globalMockToggle');
        if (btn) {
            btn.innerText = this.state.isMockMode ? "Giả Lập: BẬT" : "Giả Lập: TẮT";
        }
    },

    setConnectionStatus: function(isOnline, mode = null) {
        this.state.isConnected = isOnline;
        const badge = document.getElementById('globalStatusBadge');
        const text = document.getElementById('globalStatusText');
        if (!badge || !text) return;

        badge.className = "status-pill";
        if (mode === 'mock' || (this.state.isMockMode && isOnline)) {
            badge.classList.add('mock');
            text.innerText = "Mô Phỏng";
        } else if (isOnline) {
            badge.classList.add('online');
            text.innerText = "Đã Kết Nối";
        } else {
            badge.classList.add('offline');
            text.innerText = "Mất Kết Nối";
        }
    },

    /**
     * Đồng hồ thời gian thực
     */
    startClock: function() {
        const update = () => {
            const el = document.getElementById('globalClockText');
            if (el) {
                const now = new Date();
                const time = now.toLocaleTimeString('vi-VN', { hour12: false });
                const date = now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
                el.innerText = `${time} - ${date}`;
            }
        };
        update();
        setInterval(update, 1000);
    },

    /**
     * =========================================================================
     * QUẢN LÝ NGƯỜI DÙNG & PHÂN QUYỀN GIA ĐÌNH (CLOUD FIRESTORE)
     * =========================================================================
     */

    /**
     * Cập nhật badge người dùng hiện tại trên Header
     */
    renderHeaderUserBadge: function() {
        const avatar = document.getElementById('headerUserAvatar');
        const name = document.getElementById('headerUserName');
        const role = document.getElementById('headerUserRole');

        if (this.state.currentUser) {
            const u = this.state.currentUser;
            if (avatar) {
                avatar.innerText = u.name ? u.name.charAt(0).toUpperCase() : "U";
                if (u.avatarColor) avatar.style.background = u.avatarColor;
            }
            if (name) name.innerText = u.name;
            if (role) {
                const isAdmin = (u.role === 'admin');
                role.innerText = isAdmin ? "Admin" : "Thành viên";
                role.className = isAdmin ? "user-role-tag admin" : "user-role-tag user";
            }
        }
    },

    /**
     * Callback khi Cloud Firestore cập nhật danh sách thành viên gia đình
     */
    onFamilyMembersUpdate: function(members) {
        if (members && members.length > 0) {
            this.state.familyMembers = members;
            // Nếu người dùng hiện tại trùng với ID trong Firestore, cập nhật lại quyền
            const matched = members.find(m => m.id === this.state.currentUser.id || m.name === this.state.currentUser.name);
            if (matched) {
                this.state.currentUser = { ...this.state.currentUser, ...matched };
            }
            this.renderHeaderUserBadge();
            if (document.getElementById('usersPageMarker')) {
                this.renderUsersPage();
            }
        }
    },

    /**
     * Render trang Quản Lý Thành Viên Gia Đình (users.html)
     */
    renderUsersPage: function() {
        const container = document.getElementById('familyMemberList');
        const countTotal = document.getElementById('countTotalMembers');
        const countAdmins = document.getElementById('countAdminMembers');
        const countUsers = document.getElementById('countRegularMembers');
        const countOnline = document.getElementById('countOnlineMembers');

        const members = this.state.familyMembers;
        if (!container) return;

        // Cập nhật số liệu thống kê
        const total = members.length;
        const admins = members.filter(m => m.role === 'admin').length;
        const regularUsers = total - admins;
        const onlines = members.filter(m => m.status === 'online').length;

        if (countTotal) countTotal.innerText = total;
        if (countAdmins) countAdmins.innerText = admins;
        if (countUsers) countUsers.innerText = regularUsers;
        if (countOnline) countOnline.innerText = onlines;

        // Vẽ danh sách thẻ thành viên
        container.innerHTML = '';
        members.forEach(m => {
            const isAdmin = (m.role === 'admin');
            const isCurrent = (this.state.currentUser && (this.state.currentUser.id === m.id || this.state.currentUser.name === m.name));
            const card = document.createElement('div');
            card.className = 'member-card';

            card.innerHTML = `
                <div>
                    <div class="member-header">
                        <div class="member-avatar-lg" style="background: ${m.avatarColor || '#2563eb'};">
                            ${m.name ? m.name.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div class="member-title-block" style="flex:1;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <h4>${m.name}</h4>
                                <span class="status-pill ${m.status === 'online' ? 'online' : 'offline'}" style="font-size:0.65rem; padding:2px 6px;">
                                    <span class="dot"></span>
                                    <span>${m.status === 'online' ? 'Online' : 'Offline'}</span>
                                </span>
                            </div>
                            <span>${m.relationship || 'Thành viên'} &bull; <strong style="color:${isAdmin ? '#1d4ed8' : '#475569'};">${isAdmin ? 'QUẢN TRỊ VIÊN (ADMIN)' : 'NGƯỜI DÙNG (USER)'}</strong></span>
                        </div>
                    </div>

                    <div class="member-details">
                        <div class="member-detail-row">
                            <span style="color:var(--text-muted);">Số điện thoại:</span>
                            <span style="font-weight:600; font-family:monospace;">${m.phone || 'Chưa cập nhật'}</span>
                        </div>
                        <div class="member-detail-row">
                            <span style="color:var(--text-muted);">Hoạt động gần nhất:</span>
                            <span style="font-weight:600;">${m.lastActive || 'Hôm nay'}</span>
                        </div>
                        ${m.last_action ? `
                        <div class="member-detail-row">
                            <span style="color:var(--text-muted);">Chức năng dùng gần nhất:</span>
                            <span style="font-weight:600; color:var(--accent-primary);">${m.last_action}</span>
                        </div>` : ''}
                    </div>

                    <div style="font-size:0.75rem; color:var(--text-secondary); font-weight:600; margin-bottom:0.4rem;">Quyền hạn điều khiển:</div>
                    <div class="permission-badges">
                        <span class="perm-pill ${m.can_unlock_door ? 'active' : ''}">
                            ${m.can_unlock_door ? '✓ Mở khóa cửa' : '✕ Không mở cửa'}
                        </span>
                        <span class="perm-pill ${m.can_trigger_alarm ? 'active' : ''}">
                            ${m.can_trigger_alarm ? '✓ Bật báo động' : '✕ Không báo động'}
                        </span>
                        <span class="perm-pill active">✓ Bật/tắt đèn</span>
                        <span class="perm-pill active">✓ Xem cảm biến</span>
                    </div>
                </div>

                <div class="member-actions">
                    <button class="btn-action" style="flex:1; justify-content:center; font-size:0.75rem;" onclick="AppCore.switchToMember('${m.id}')">
                        ${isCurrent ? '★ Đang dùng' : '👤 Đăng nhập tài khoản'}
                    </button>
                    ${!isCurrent ? `
                    <button class="btn-action btn-danger" style="font-size:0.75rem; padding:0.5rem 0.7rem;" onclick="AppCore.deleteMember('${m.id}', '${m.name}')" title="Xóa khỏi Firestore">
                        ✕
                    </button>` : ''}
                </div>
            `;

            container.appendChild(card);
        });
    },

    /**
     * Chuyển đổi tài khoản người dùng đang thao tác
     */
    switchToMember: function(memberId) {
        const found = this.state.familyMembers.find(m => m.id === memberId);
        if (found) {
            this.state.currentUser = found;
            localStorage.setItem('smarthome_current_user', JSON.stringify(found));
            this.renderHeaderUserBadge();
            if (document.getElementById('usersPageMarker')) this.renderUsersPage();
            this.showToast(`Đã chuyển sang tài khoản: ${found.name} (${found.role === 'admin' ? 'Admin' : 'User'})`, "success");
        }
    },

    /**
     * Mở Modal thêm thành viên gia đình
     */
    openAddMemberModal: function() {
        const modal = document.getElementById('addMemberModalOverlay');
        if (modal) modal.classList.add('active');
    },

    closeAddMemberModal: function() {
        const modal = document.getElementById('addMemberModalOverlay');
        if (modal) modal.classList.remove('active');
    },

    /**
     * Xử lý gửi Form thêm thành viên lên Cloud Firestore
     */
    handleAddMemberFormSubmit: async function(event) {
        event.preventDefault();

        // Kiểm tra quyền: chỉ Admin mới có quyền thêm thành viên gia đình
        if (this.state.currentUser.role !== 'admin') {
            this.showToast("Chỉ Quản trị viên (Admin) mới có quyền thêm thành viên gia đình!", "error");
            return;
        }

        const nameInput = document.getElementById('newMemberName');
        const roleSelect = document.getElementById('newMemberRole');
        const relationInput = document.getElementById('newMemberRelation');
        const phoneInput = document.getElementById('newMemberPhone');
        const canDoorCheck = document.getElementById('newMemberCanDoor');
        const canAlarmCheck = document.getElementById('newMemberCanAlarm');

        const newMemberData = {
            name: nameInput.value.trim(),
            role: roleSelect.value,
            relationship: relationInput.value.trim() || (roleSelect.value === 'admin' ? 'Chủ hộ' : 'Thành viên'),
            phone: phoneInput.value.trim() || 'Chưa cập nhật',
            status: "online",
            can_unlock_door: canDoorCheck ? canDoorCheck.checked : true,
            can_trigger_alarm: canAlarmCheck ? canAlarmCheck.checked : (roleSelect.value === 'admin'),
            avatarColor: roleSelect.value === 'admin' ? '#2563eb' : '#059669'
        };

        if (!newMemberData.name) {
            this.showToast("Vui lòng nhập họ và tên thành viên!", "warn");
            return;
        }

        // 1. Thêm lên Cloud Firestore
        if (window.SmartHomeFirebase && window.SmartHomeFirebase.firestore) {
            await window.SmartHomeFirebase.addFamilyMember(newMemberData);
        } else {
            // Fallback lưu local nếu Firestore chưa mở
            newMemberData.id = "local_" + Date.now();
            this.state.familyMembers.push(newMemberData);
            this.renderUsersPage();
            this.showToast(`Đã thêm thành viên: ${newMemberData.name}`, "success");
        }

        this.closeAddMemberModal();
        nameInput.value = '';
        if (phoneInput) phoneInput.value = '';
    },

    /**
     * Xóa thành viên
     */
    deleteMember: async function(id, name) {
        if (this.state.currentUser.role !== 'admin') {
            this.showToast("Chỉ Admin mới có quyền xóa thành viên gia đình!", "error");
            return;
        }

        if (confirm(`Bạn có chắc muốn xóa thành viên "${name}" khỏi Cloud Firestore?`)) {
            if (window.SmartHomeFirebase && window.SmartHomeFirebase.firestore) {
                await window.SmartHomeFirebase.deleteFamilyMember(id, name);
            } else {
                this.state.familyMembers = this.state.familyMembers.filter(m => m.id !== id);
                this.renderUsersPage();
                this.showToast(`Đã xóa thành viên ${name}`, "warn");
            }
        }
    },

    /**
     * Mở modal chuyển đổi tài khoản nhanh
     */
    openSwitchUserModal: function() {
        const modal = document.getElementById('switchUserModalOverlay');
        if (!modal) return;
        const list = document.getElementById('quickSwitchUserList');
        if (list) {
            list.innerHTML = '';
            this.state.familyMembers.forEach(m => {
                const isCurrent = (this.state.currentUser && (this.state.currentUser.id === m.id || this.state.currentUser.name === m.name));
                const item = document.createElement('div');
                item.className = 'card-widget-item';
                item.style.cursor = 'pointer';
                item.style.borderColor = isCurrent ? 'var(--accent-primary)' : 'var(--card-border)';
                item.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div class="user-avatar" style="background:${m.avatarColor || '#2563eb'};">${m.name ? m.name.charAt(0) : 'U'}</div>
                            <div>
                                <div style="font-weight:700; font-size:0.9rem;">${m.name}</div>
                                <div style="font-size:0.75rem; color:var(--text-muted);">${m.relationship || 'Thành viên'}</div>
                            </div>
                        </div>
                        <div>
                            <span class="user-role-tag ${m.role === 'admin' ? 'admin' : 'user'}">${m.role === 'admin' ? 'Admin' : 'User'}</span>
                            ${isCurrent ? '<span style="font-size:0.75rem; color:var(--accent-primary); font-weight:700; margin-left:6px;">★ Đang chọn</span>' : ''}
                        </div>
                    </div>
                `;
                item.onclick = () => {
                    this.switchToMember(m.id);
                    this.closeSwitchUserModal();
                };
                list.appendChild(item);
            });

            // Thêm nút đi tới trang Đăng nhập hoặc Đăng xuất
            const actionsDiv = document.createElement('div');
            actionsDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-top:0.75rem; padding-top:0.75rem; border-top:1px solid var(--card-border);";
            actionsDiv.innerHTML = `
                <a href="login.html" class="btn-action" style="font-size:0.75rem; text-decoration:none;">Trang Đăng Nhập &rarr;</a>
                <button class="btn-action btn-danger" style="font-size:0.75rem;" onclick="AppCore.logout()">Đăng Xuất</button>
            `;
            list.appendChild(actionsDiv);
        }
        modal.classList.add('active');
    },

    closeSwitchUserModal: function() {
        const modal = document.getElementById('switchUserModalOverlay');
        if (modal) modal.classList.remove('active');
    },

    /**
     * Đăng xuất khỏi hệ thống và chuyển về login.html
     */
    logout: function() {
        if (confirm("Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?")) {
            localStorage.removeItem('smarthome_current_user');
            window.location.href = 'login.html';
        }
    },

    /**
     * Thông báo Toast & Activity Log
     */
    showToast: function(message, type = 'info') {
        let container = document.getElementById('globalToastBox');
        if (!container) {
            container = document.createElement('div');
            container.id = 'globalToastBox';
            container.className = 'toast-box';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast-item ${type}`;
        toast.innerHTML = `
            <span>${message}</span>
            <span style="cursor:pointer; margin-left:8px; opacity:0.6;" onclick="this.parentElement.remove()">&times;</span>
        `;
        container.appendChild(toast);
        setTimeout(() => { if (toast.parentElement) toast.remove(); }, 3500);
    },

    addLog: function(msg, type = '') {
        const logBox = document.getElementById('globalLogBox');
        if (!logBox) return;
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `<span style="color:var(--text-dim); margin-right:4px;">[${timeStr}]</span> ${msg}`;
        logBox.prepend(entry);
        while (logBox.children.length > 30) logBox.removeChild(logBox.lastChild);
    },

    /**
     * Quản lý Nền Giao Diện & Themes (Biệt thự kính hiện đại / Dark Cyber / Sáng tối giản)
     */
    initTheme: function() {
        const savedTheme = localStorage.getItem('smarthome_theme') || 'villa';
        this.applyTheme(savedTheme, false);
    },

    applyTheme: function(theme, notify = true) {
        document.body.classList.remove('theme-villa', 'theme-mansion', 'theme-dark', 'theme-light');
        document.body.classList.add('theme-' + theme);
        localStorage.setItem('smarthome_theme', theme);

        const themeBtn = document.getElementById('themeSwitchBtn');
        if (themeBtn) {
            const labels = {
                'villa': '🏡 Biệt Thự Hoàng Hôn',
                'mansion': '🏰 Dinh Thự Kính',
                'dark': '🌌 Dark Cyber',
                'light': '☁️ Sáng Tinh Tế'
            };
            themeBtn.innerHTML = labels[theme] || '🎨 Đổi Giao Diện';
        }

        if (notify) {
            const names = {
                'villa': 'Biệt Thự Hoàng Hôn & Hồ Bơi (Siêu Đẹp)',
                'mansion': 'Dinh Thự Kính Hiện Đại (Sang Trọng)',
                'dark': 'Dark Mode Cyber (Theo ảnh mẫu)',
                'light': 'Sáng Tinh Tế (Soft Glass)'
            };
            this.showToast("Đã đổi sang giao diện: " + (names[theme] || theme), "info");
        }
    },

    toggleTheme: function() {
        const current = localStorage.getItem('smarthome_theme') || 'villa';
        let next = 'villa';
        if (current === 'villa') next = 'mansion';
        else if (current === 'mansion') next = 'dark';
        else if (current === 'dark') next = 'light';
        else if (current === 'light') next = 'villa';
        this.applyTheme(next, true);
    },

    // =========================================================================
    // QUẢN LÝ TẠO PHÒNG & NODE PHẦN CỨNG MỞ RỘNG (DYNAMICAL CUSTOM ROOMS)
    // Cho phép thêm phòng mới, tự cấp mã Node, nhận dữ liệu thời gian thực
    // và xuất code Arduino ESP32 tương ứng mà KHÔNG CẦN SỬA CODE WEB
    // =========================================================================

    /**
     * Tải danh sách phòng tùy chỉnh từ localStorage
     */
    loadCustomRooms: function() {
        try {
            const raw = localStorage.getItem('smarthome_custom_rooms');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this.state.customRooms = parsed;
                }
            }
        } catch (e) {
            console.warn("⚠️ Không thể tải danh sách custom rooms:", e);
        }
    },

    /**
     * Lưu danh sách phòng vào localStorage và đồng bộ lên Firebase
     */
    saveCustomRooms: function() {
        this.saveCustomRoomsToStorageOnly();
        if (window.SmartHomeFirebase && typeof window.SmartHomeFirebase.saveRoomsConfig === 'function') {
            window.SmartHomeFirebase.saveRoomsConfig(this.state.customRooms);
        }
    },

    saveCustomRoomsToStorageOnly: function() {
        try {
            localStorage.setItem('smarthome_custom_rooms', JSON.stringify(this.state.customRooms));
        } catch (e) {}
    },

    /**
     * Mở modal thêm phòng mới
     */
    openAddRoomModal: function() {
        const modal = document.getElementById('addRoomModalOverlay');
        if (!modal) return;
        modal.style.display = 'flex';
        const nameInput = document.getElementById('newRoomName');
        if (nameInput) {
            nameInput.value = '';
            nameInput.focus();
        }
        const nodeIdInput = document.getElementById('newRoomNodeId');
        if (nodeIdInput) nodeIdInput.value = '';
        const preview = document.getElementById('nodeIdPreview');
        if (preview) preview.innerText = 'node_id';
    },

    /**
     * Đóng modal thêm phòng mới
     */
    closeAddRoomModal: function() {
        const modal = document.getElementById('addRoomModalOverlay');
        if (modal) modal.style.display = 'none';
    },

    /**
     * Tự động tạo Node ID từ tên phòng gõ vào
     */
    autoGenerateNodeId: function(name) {
        if (!name) return '';
        const clean = name.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[đĐ]/g, 'd')
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        
        const finalId = clean || 'node_1';
        const input = document.getElementById('newRoomNodeId');
        const preview = document.getElementById('nodeIdPreview');
        if (input) input.value = finalId;
        if (preview) preview.innerText = finalId;
        return finalId;
    },

    /**
     * Xử lý submit form tạo phòng mới
     */
    handleCreateRoomSubmit: function(e) {
        if (e) e.preventDefault();
        const nameInput = document.getElementById('newRoomName');
        const nodeIdInput = document.getElementById('newRoomNodeId');
        if (!nameInput || !nodeIdInput) return;

        const name = nameInput.value.trim();
        let nodeId = nodeIdInput.value.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '_');

        if (!name) {
            this.showToast("Vui lòng nhập tên phòng!", "warn");
            return;
        }
        if (!nodeId) {
            nodeId = this.autoGenerateNodeId(name) || ('node_' + Date.now().toString().slice(-4));
        }

        // Kiểm tra xem nodeId đã tồn tại chưa
        if (this.state.customRooms && this.state.customRooms.some(r => r.nodeId === nodeId)) {
            this.showToast(`Mã Node "${nodeId}" đã tồn tại! Vui lòng chọn mã khác.`, "error");
            return;
        }

        // Lấy icon đã chọn
        let selectedIcon = '🛏️';
        const iconRadio = document.querySelector('input[name="roomIcon"]:checked');
        if (iconRadio) selectedIcon = iconRadio.value;

        // Lấy các tính năng đã chọn
        const hasTempHum = document.getElementById('checkDht') ? document.getElementById('checkDht').checked : true;
        const hasGas = document.getElementById('checkGas') ? document.getElementById('checkGas').checked : false;
        const hasPir = document.getElementById('checkPir') ? document.getElementById('checkPir').checked : false;
        const hasLight = document.getElementById('checkLight') ? document.getElementById('checkLight').checked : true;
        const hasFan = document.getElementById('checkFan') ? document.getElementById('checkFan').checked : false;

        const newRoom = {
            id: 'room_' + Date.now(),
            name: name,
            nodeId: nodeId,
            icon: selectedIcon,
            createdAt: new Date().toISOString(),
            features: {
                hasTempHum: hasTempHum,
                hasGas: hasGas,
                hasPir: hasPir,
                hasLight: hasLight,
                hasFan: hasFan
            },
            sensors: {
                temp: null,
                hum: null,
                gas: null,
                pir: null
            },
            devices: {
                light: false,
                fan: false
            }
        };

        if (!this.state.customRooms) this.state.customRooms = [];
        this.state.customRooms.push(newRoom);
        this.saveCustomRooms();
        this.renderCustomRooms();
        this.closeAddRoomModal();

        this.showToast(`✨ Đã tạo phòng "${name}" thành công! Bấm "📋 Code ESP32" để lấy code nạp vào vi xử lý.`, "success");
        this.addLog(`Đã tạo phòng mới: ${name} (Node: ${nodeId})`, "cmd");
    },

    /**
     * Xóa một phòng / node tùy chỉnh
     */
    deleteCustomRoom: async function(nodeId) {
        const room = this.state.customRooms ? this.state.customRooms.find(r => r.nodeId === nodeId) : null;
        const roomName = room ? room.name : nodeId;
        if (!confirm(`Bạn có chắc chắn muốn xóa phòng "${roomName}" (/nodes/${nodeId}) khỏi hệ thống?`)) {
            return;
        }

        this.state.customRooms = this.state.customRooms.filter(r => r.nodeId !== nodeId);
        this.saveCustomRooms();
        this.renderCustomRooms();
        this.showToast(`Đã xóa phòng "${roomName}" thành công!`, "warn");
        this.addLog(`Đã xóa phòng / node: ${roomName} (${nodeId})`, "cmd");

        // Dọn dẹp trên Firebase Realtime Database nếu có kết nối
        if (window.SmartHomeFirebase && window.SmartHomeFirebase.db) {
            try {
                await window.SmartHomeFirebase.db.ref(`nodes/${nodeId}`).remove();
            } catch(e) {}
        }
    },

    /**
     * Bật / Tắt thiết bị thuộc một phòng tùy chỉnh (Relay qua Firebase)
     */
    toggleCustomDevice: async function(nodeId, deviceKey, isChecked) {
        const room = this.state.customRooms ? this.state.customRooms.find(r => r.nodeId === nodeId) : null;
        if (room) {
            if (!room.devices) room.devices = {};
            if (deviceKey === 'den') room.devices.light = isChecked;
            if (deviceKey === 'quat') room.devices.fan = isChecked;
            this.saveCustomRoomsToStorageOnly();
        }

        const deviceName = (deviceKey === 'den') ? 'Đèn' : 'Quạt';
        const roomName = room ? room.name : nodeId;
        const actionText = isChecked ? 'BẬT' : 'TẮT';

        if (window.SmartHomeFirebase && typeof window.SmartHomeFirebase.sendNodeCommand === 'function') {
            await window.SmartHomeFirebase.sendNodeCommand(nodeId, deviceKey, isChecked);
            this.showToast(`Đã ${actionText} ${deviceName} [${roomName}]!`, "success");
            this.addLog(`${actionText} ${deviceName} [${roomName}] qua Firebase`, "cmd");
        } else {
            this.showToast(`Đã ${actionText} ${deviceName} [${roomName}] (Cục bộ)`, "info");
        }
    },

    /**
     * Cập nhật dữ liệu từ Firebase /nodes/<nodeId>/...
     * Có tính năng Auto-Discovery: Nếu có node phần cứng gửi lên mà web chưa tạo phòng, web tự động thêm phòng luôn!
     */
    handleCustomNodesUpdate: function(nodesData) {
        if (!nodesData || typeof nodesData !== 'object') return;
        if (!this.state.customRooms) this.state.customRooms = [];
        let hasChanges = false;

        Object.keys(nodesData).forEach(nodeId => {
            const nodeVal = nodesData[nodeId];
            if (!nodeVal || typeof nodeVal !== 'object') return;

            let room = this.state.customRooms.find(r => r.nodeId === nodeId);
            if (!room) {
                // Auto-discovery: Tự tạo phòng cho phần cứng mới
                room = {
                    id: 'room_' + nodeId,
                    name: 'Phòng ' + nodeId.replace(/_/g, ' ').toUpperCase(),
                    nodeId: nodeId,
                    icon: '⚡',
                    createdAt: new Date().toISOString(),
                    features: {
                        hasTempHum: (nodeVal.nhiet_do !== undefined || nodeVal.temp !== undefined || nodeVal.do_am !== undefined),
                        hasGas: (nodeVal.gas !== undefined),
                        hasPir: (nodeVal.pir !== undefined),
                        hasLight: (nodeVal.den !== undefined || nodeVal.light !== undefined),
                        hasFan: (nodeVal.quat !== undefined || nodeVal.fan !== undefined)
                    },
                    sensors: {},
                    devices: {}
                };
                this.state.customRooms.push(room);
                hasChanges = true;
                this.showToast(`📡 Phát hiện phần cứng mới: Node [${nodeId}]!`, "info");
            }

            if (!room.sensors) room.sensors = {};
            if (!room.devices) room.devices = {};

            // Cập nhật giá trị cảm biến
            if (nodeVal.nhiet_do !== undefined) room.sensors.temp = parseFloat(nodeVal.nhiet_do);
            else if (nodeVal.temp !== undefined) room.sensors.temp = parseFloat(nodeVal.temp);

            if (nodeVal.do_am !== undefined) room.sensors.hum = parseFloat(nodeVal.do_am);
            else if (nodeVal.hum !== undefined) room.sensors.hum = parseFloat(nodeVal.hum);

            if (nodeVal.gas !== undefined) room.sensors.gas = parseInt(nodeVal.gas);
            if (nodeVal.pir !== undefined) room.sensors.pir = Boolean(nodeVal.pir);

            // Cập nhật công tắc thiết bị
            if (nodeVal.den !== undefined) room.devices.light = Boolean(nodeVal.den);
            else if (nodeVal.light !== undefined) room.devices.light = Boolean(nodeVal.light);

            if (nodeVal.quat !== undefined) room.devices.fan = Boolean(nodeVal.quat);
            else if (nodeVal.fan !== undefined) room.devices.fan = Boolean(nodeVal.fan);

            hasChanges = true;
        });

        if (hasChanges) {
            this.saveCustomRoomsToStorageOnly();
            this.renderCustomRooms();
        }
    },

    /**
     * Render danh sách các phòng / Node mở rộng trên giao diện Dashboard
     */
    renderCustomRooms: function() {
        const grid = document.getElementById('customRoomsGrid');
        const badge = document.getElementById('customRoomsCountBadge');
        if (!grid) return;

        const count = this.state.customRooms ? this.state.customRooms.length : 0;
        if (badge) {
            badge.innerText = `${count} Phòng Mới`;
            badge.className = count > 0 ? "status-pill online" : "status-pill offline";
        }

        if (count === 0) {
            grid.innerHTML = `
                <div class="empty-room-card" style="grid-column: 1 / -1; padding: 2.5rem 1.5rem; text-align: center; border-radius: var(--radius-lg); background: var(--card-bg); border: 2px dashed var(--card-border); backdrop-filter: blur(12px);">
                    <div style="font-size: 2.8rem; margin-bottom: 0.75rem;">🏡✨</div>
                    <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.4rem;">Chưa có Phòng hoặc Node mở rộng nào</h3>
                    <p style="font-size: 0.85rem; color: var(--text-muted); max-width: 520px; margin: 0 auto 1.25rem; line-height: 1.6;">
                        Bạn muốn thêm phòng ngủ, sân thượng, nhà kho hay sân vườn? Chỉ cần bấm nút bên dưới, đặt tên phòng và chọn cảm biến. Hệ thống sẽ cấp sẵn mã Node và code nạp ESP32 mà <strong>không cần sửa code web</strong>!
                    </p>
                    <button class="btn-action" style="background:var(--accent-primary); color:#ffffff; font-weight:700; border-color:var(--accent-primary); padding:0.6rem 1.4rem; box-shadow:0 4px 15px rgba(37,99,235,0.35);" onclick="AppCore.openAddRoomModal()">
                        + Thêm Phòng / Tạo Node Mới
                    </button>
                </div>
            `;
            return;
        }

        let html = '';
        this.state.customRooms.forEach(room => {
            const feat = room.features || { hasTempHum: true, hasGas: true, hasPir: false, hasLight: true, hasFan: false };
            const sens = room.sensors || {};
            const devs = room.devices || {};

            const hasTemp = (sens.temp !== null && sens.temp !== undefined && !isNaN(sens.temp));
            const hasHum = (sens.hum !== null && sens.hum !== undefined && !isNaN(sens.hum));
            const hasGas = (sens.gas !== null && sens.gas !== undefined && !isNaN(sens.gas));
            const hasPir = (sens.pir !== null && sens.pir !== undefined);

            html += `
                <div class="dashboard-card" style="position:relative; overflow:hidden;" data-node-id="${room.nodeId}">
                    <!-- Header -->
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div style="width:42px; height:42px; border-radius:12px; background:var(--accent-primary-light); color:var(--accent-primary); display:flex; align-items:center; justify-content:center; font-size:1.4rem;">
                                ${room.icon || '🏡'}
                            </div>
                            <div>
                                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0;">${room.name}</h3>
                                <span class="status-pill online" style="font-size:0.68rem; margin-top:2px; display:inline-block; font-family:monospace; background:rgba(37,99,235,0.08); color:var(--accent-primary); border:1px solid rgba(37,99,235,0.25);">
                                    /nodes/${room.nodeId}
                                </span>
                            </div>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button class="btn-pill" style="font-size:0.75rem; padding:0.35rem 0.7rem; background:rgba(37,99,235,0.1); color:var(--accent-primary); border-color:var(--accent-primary); font-weight:700;" onclick="AppCore.openEspCodeModal('${room.nodeId}')" title="Lấy mã nguồn Arduino/ESP32 cho node này">
                                📋 Code ESP32
                            </button>
                            <button class="btn-pill" style="font-size:0.75rem; padding:0.35rem 0.6rem; background:rgba(239,68,68,0.1); color:var(--accent-red); border-color:rgba(239,68,68,0.3);" onclick="AppCore.deleteCustomRoom('${room.nodeId}')" title="Xóa phòng này">
                                🗑️
                            </button>
                        </div>
                    </div>

                    <!-- Sensor metrics row -->
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(95px, 1fr)); gap:8px; margin-bottom:1rem; padding:0.75rem; background:rgba(255,255,255,0.04); border-radius:10px; border:1px solid var(--card-border);">
                        ${feat.hasTempHum ? `
                            <div style="text-align:center;">
                                <span style="font-size:0.72rem; color:var(--text-muted); display:block;">Nhiệt độ</span>
                                <span style="font-size:1.15rem; font-weight:800; color:var(--accent-primary);">
                                    ${hasTemp ? Number(sens.temp).toFixed(1) + '°C' : '-- °C'}
                                </span>
                                <span style="display:block; font-size:0.65rem; color:var(--text-muted);">
                                    ${hasTemp ? 'Live' : 'Chờ cảm biến...'}
                                </span>
                            </div>
                            <div style="text-align:center;">
                                <span style="font-size:0.72rem; color:var(--text-muted); display:block;">Độ ẩm</span>
                                <span style="font-size:1.15rem; font-weight:800; color:var(--accent-indigo);">
                                    ${hasHum ? sens.hum + '%' : '-- %'}
                                </span>
                                <span style="display:block; font-size:0.65rem; color:var(--text-muted);">
                                    ${hasHum ? 'Live' : 'Chờ cảm biến...'}
                                </span>
                            </div>
                        ` : ''}

                        ${feat.hasGas ? `
                            <div style="text-align:center;">
                                <span style="font-size:0.72rem; color:var(--text-muted); display:block;">Khí Gas</span>
                                <span style="font-size:1.15rem; font-weight:800; color:${(hasGas && sens.gas >= 400) ? 'var(--accent-red)' : 'var(--accent-green)'};">
                                    ${hasGas ? sens.gas + ' PPM' : '-- PPM'}
                                </span>
                                <span style="display:block; font-size:0.65rem; color:var(--text-muted);">
                                    ${hasGas ? (sens.gas >= 400 ? '⚠️ Nguy hiểm' : 'An toàn') : 'Chờ MQ2...'}
                                </span>
                            </div>
                        ` : ''}

                        ${feat.hasPir ? `
                            <div style="text-align:center;">
                                <span style="font-size:0.72rem; color:var(--text-muted); display:block;">Chuyển động</span>
                                <span style="font-size:0.95rem; font-weight:700; color:${(hasPir && sens.pir) ? 'var(--accent-amber)' : 'var(--text-muted)'}; margin-top:3px; display:block;">
                                    ${hasPir ? (sens.pir ? '🚨 Có người' : 'Yên tĩnh') : 'Chờ PIR...'}
                                </span>
                                <span style="display:block; font-size:0.65rem; color:var(--text-muted);">Cảm biến PIR</span>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Actuator / Devices controls -->
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        ${feat.hasLight ? `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.6rem; background:rgba(0,0,0,0.03); border-radius:8px;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <span style="font-size:1.1rem;">💡</span>
                                    <span style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Đèn Chiếu Sáng</span>
                                </div>
                                <label class="switch-toggle">
                                    <input type="checkbox" ${devs.light ? 'checked' : ''} onchange="AppCore.toggleCustomDevice('${room.nodeId}', 'den', this.checked)">
                                    <span class="slider"></span>
                                </label>
                            </div>
                        ` : ''}

                        ${feat.hasFan ? `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.6rem; background:rgba(0,0,0,0.03); border-radius:8px;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <span style="font-size:1.1rem;">🌀</span>
                                    <span style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Quạt / Thông Gió</span>
                                </div>
                                <label class="switch-toggle">
                                    <input type="checkbox" ${devs.fan ? 'checked' : ''} onchange="AppCore.toggleCustomDevice('${room.nodeId}', 'quat', this.checked)">
                                    <span class="slider"></span>
                                </label>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;
    },

    /**
     * Mở modal xem code ESP32
     */
    openEspCodeModal: function(nodeId) {
        const room = this.state.customRooms ? this.state.customRooms.find(r => r.nodeId === nodeId) : null;
        const modal = document.getElementById('espCodeModalOverlay');
        const title = document.getElementById('espModalTitle');
        const textarea = document.getElementById('espCodeTextarea');
        if (!modal) return;

        const roomName = room ? room.name : nodeId;
        const features = room ? (room.features || {}) : { hasTempHum: true, hasGas: true, hasPir: true, hasLight: true, hasFan: true };

        if (title) title.innerText = `Mã Nguồn ESP32 - ${roomName} (/nodes/${nodeId})`;
        if (textarea) textarea.value = this.generateEsp32Code(nodeId, roomName, features);

        modal.style.display = 'flex';
    },

    /**
     * Đóng modal xem code ESP32
     */
    closeEspCodeModal: function() {
        const modal = document.getElementById('espCodeModalOverlay');
        if (modal) modal.style.display = 'none';
    },

    /**
     * Sao chép code ESP32 vào clipboard
     */
    copyEspCode: function() {
        const textarea = document.getElementById('espCodeTextarea');
        if (!textarea) return;
        textarea.select();
        navigator.clipboard.writeText(textarea.value).then(() => {
            this.showToast("Đã sao chép toàn bộ code ESP32! Dán vào Arduino IDE để nạp vào mạch.", "success");
        }).catch(() => {
            document.execCommand('copy');
            this.showToast("Đã sao chép code ESP32!", "success");
        });
    },

    /**
     * Tự động sinh mã nguồn Arduino C++ cho mạch ESP32
     */
    generateEsp32Code: function(nodeId, roomName, features) {
        return `/*
 * ==================================================================================
 * CODE ARDUINO / ESP32 CHO: ${roomName.toUpperCase()}
 * Hardware Node ID: ${nodeId}
 * Tự động gửi cảm biến và nhận lệnh điều khiển qua Firebase Realtime Database
 * Không cần chỉnh sửa bất kỳ code nào trên Web!
 * ==================================================================================
 */

#include <WiFi.h>
#include <FirebaseESP32.h>
${features.hasTempHum ? '#include <DHT.h>\\n' : ''}
// 1. CẤU HÌNH WIFI (Điền thông tin mạng Wi-Fi nhà bạn)
#define WIFI_SSID "Ten_WiFi_Nha_Ban"
#define WIFI_PASSWORD "Mat_Khau_WiFi"

// 2. CẤU HÌNH FIREBASE REALTIME DATABASE
#define FIREBASE_HOST "https://do-an2-af4f8-default-rtdb.asia-southeast1.firebasedatabase.app/"
#define FIREBASE_AUTH "" // Để trống nếu Realtime Database Rules ở chế độ test (.read: true, .write: true)

// 3. ĐỊNH NGHĨA CHÂN NỐI CẢM BIẾN & THIẾT BỊ (PINOUT)
${features.hasTempHum ? '#define DHTPIN 4\\n#define DHTTYPE DHT11\\nDHT dht(DHTPIN, DHTTYPE);\\n' : ''}
${features.hasGas ? '#define MQ2_PIN 34 // Cổng Analog A0 đọc nồng độ khí Gas / Khói\\n' : ''}
${features.hasPir ? '#define PIR_PIN 13 // Chân Digital đọc cảm biến chuyển động PIR\\n' : ''}
${features.hasLight ? '#define RELAY_DEN 18 // Relay điều khiển Đèn Chiếu Sáng\\n' : ''}
${features.hasFan ? '#define RELAY_QUAT 19 // Relay điều khiển Quạt / Thông Gió\\n' : ''}
FirebaseData fbdo;
FirebaseData streamData;
FirebaseAuth auth;
FirebaseConfig config;

unsigned long lastSensorSendTime = 0;
const unsigned long SENSOR_SEND_INTERVAL = 3000; // Gửi dữ liệu cảm biến mỗi 3 giây

// Hàm xử lý nhận lệnh điều khiển tức thì từ Web qua Stream
void streamCallback(StreamData data) {
    String path = data.dataPath();
    Serial.printf("[Firebase] Nhận lệnh tại path: %s\\\\n", path.c_str());
    
    ${features.hasLight ? `if (path == "/den" || path == "") {
        bool denState = false;
        if (data.dataType() == "boolean") denState = data.boolData();
        else if (data.dataType() == "int") denState = (data.intData() == 1);
        digitalWrite(RELAY_DEN, denState ? HIGH : LOW);
        Serial.printf("💡 Đèn ${roomName}: %s\\\\n", denState ? "BẬT" : "TẮT");
    }` : ''}

    ${features.hasFan ? `if (path == "/quat" || path == "") {
        bool quatState = false;
        if (data.dataType() == "boolean") quatState = data.boolData();
        else if (data.dataType() == "int") quatState = (data.intData() == 1);
        digitalWrite(RELAY_QUAT, quatState ? HIGH : LOW);
        Serial.printf("🌀 Quạt ${roomName}: %s\\\\n", quatState ? "BẬT" : "TẮT");
    }` : ''}
}

void streamTimeoutCallback(bool timeout) {
    if (timeout) Serial.println("[Stream] Bị timeout, đang tự động kết nối lại...");
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\\\\n=== KHỞI ĐỘNG NODE: ${nodeId} (${roomName}) ===");

    ${features.hasLight ? 'pinMode(RELAY_DEN, OUTPUT);\\ndigitalWrite(RELAY_DEN, LOW);\\n' : ''}
    ${features.hasFan ? 'pinMode(RELAY_QUAT, OUTPUT);\\ndigitalWrite(RELAY_QUAT, LOW);\\n' : ''}
    ${features.hasPir ? 'pinMode(PIR_PIN, INPUT);\\n' : ''}
    ${features.hasTempHum ? 'dht.begin();\\n' : ''}

    // Kết nối Wi-Fi
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Dang ket noi WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\\\\n✅ WiFi đã kết nối! IP: " + WiFi.localIP().toString());

    // Cấu hình Firebase
    config.host = FIREBASE_HOST;
    config.signer.tokens.legacy_token = FIREBASE_AUTH;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);

    // Lắng nghe thay đổi trạng thái các công tắc điều khiển từ web
    if (!Firebase.beginStream(streamData, "/nodes/${nodeId}")) {
        Serial.printf("Stream loi: %s\\\\n", streamData.errorReason().c_str());
    }
    Firebase.setStreamCallback(streamData, streamCallback, streamTimeoutCallback);
    
    Serial.println("✅ Node đã sẵn sàng truyền nhận thời gian thực với Web!");
}

void loop() {
    // Định kỳ đọc và gửi dữ liệu cảm biến lên Firebase Realtime Database
    if (millis() - lastSensorSendTime >= SENSOR_SEND_INTERVAL) {
        lastSensorSendTime = millis();

        ${features.hasTempHum ? `
        float t = dht.readTemperature();
        float h = dht.readHumidity();
        if (!isnan(t) && !isnan(h)) {
            Firebase.setFloat(fbdo, "/nodes/${nodeId}/nhiet_do", t);
            Firebase.setFloat(fbdo, "/nodes/${nodeId}/do_am", h);
            Serial.printf("🌡️ Nhiệt độ: %.1f *C | Độ ẩm: %.1f %%\\\\n", t, h);
        }
        ` : ''}

        ${features.hasGas ? `
        int gasRaw = analogRead(MQ2_PIN);
        // Ước tính PPM từ giá trị Analog ESP32 (0-4095)
        int gasPpm = map(gasRaw, 0, 4095, 50, 800);
        Firebase.setInt(fbdo, "/nodes/${nodeId}/gas", gasPpm);
        Serial.printf("⚠️ Gas MQ2: %d PPM\\\\n", gasPpm);
        ` : ''}

        ${features.hasPir ? `
        bool pirState = digitalRead(PIR_PIN) == HIGH;
        Firebase.setBool(fbdo, "/nodes/${nodeId}/pir", pirState);
        Serial.printf("🚶 PIR: %s\\\\n", pirState ? "CÓ NGƯỜI" : "YÊN TĨNH");
        ` : ''}
    }
}`;
    }
};

// Khởi chạy khi DOM sẵn sàng
window.addEventListener('DOMContentLoaded', () => {
    AppCore.init();
});
