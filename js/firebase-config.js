/**
 * =============================================================================
 * MODULE KẾT NỐI & ĐỒNG BỘ DỮ LIỆU ĐÁM MÂY VỚI FIREBASE REALTIME DATABASE
 * Dự Án: smarthome-75c59
 * Hệ Thống Nhà Thông Minh v1
 * =============================================================================
 */

const SmartHomeFirebase = {
    // Đã kích hoạt kết nối với Firebase
    isFirebaseEnabled: true,

    // Cấu hình Firebase Project smarthome-75c59 chính thức
    config: {
        apiKey: "AIzaSyBzp4Kx852yJssd1seZgvicFwHhKmYkkqk",
        authDomain: "smarthome-75c59.firebaseapp.com",
        databaseURL: "https://smarthome-75c59-default-rtdb.firebaseio.com",
        projectId: "smarthome-75c59",
        storageBucket: "smarthome-75c59.firebasestorage.app",
        messagingSenderId: "618128698522",
        appId: "1:618128698522:web:2c08b025d7221c360c4323",
        measurementId: "G-Q5EL4QR8TK"
    },

    db: null,
    firestore: null,
    app: null,
    isConnected: false,
    familyMembers: [],

    /**
     * Khởi tạo kết nối tới Firebase SDK (Realtime Database + Cloud Firestore)
     */
    init: function(onDataCallback) {
        if (!this.isFirebaseEnabled) return false;

        if (typeof firebase === 'undefined') {
            console.warn("⚠️ [Firebase] Thư viện Firebase Compat SDK chưa được nạp. Vui lòng kiểm tra script CDN.");
            return false;
        }

        try {
            if (!firebase.apps.length) {
                this.app = firebase.initializeApp(this.config);
            } else {
                this.app = firebase.app();
            }

            // 1. Kết nối Realtime Database (cho cảm biến & thiết bị)
            this.db = (this.app && typeof this.app.database === 'function') ? this.app.database() : firebase.database();
            this.isConnected = true;
            console.log("🔥 [Firebase] Đã kết nối Realtime Database: " + this.config.databaseURL);

            // 2. Kết nối Cloud Firestore (cho Quản lý Người dùng / Thành viên gia đình)
            if (typeof firebase.firestore === 'function') {
                try {
                    this.firestore = (this.app && typeof this.app.firestore === 'function') ? this.app.firestore() : firebase.firestore();
                    console.log("🔥 [Cloud Firestore] Đã kết nối Cloud Firestore smarthome-75c59!");
                    this.listenToFamilyMembers((members) => {
                        this.familyMembers = members;
                        if (window.AppCore && typeof window.AppCore.onFamilyMembersUpdate === 'function') {
                            window.AppCore.onFamilyMembersUpdate(members);
                        }
                    });
                } catch (fsErr) {
                    console.warn("⚠️ [Cloud Firestore] Chú ý kết nối Firestore:", fsErr.message);
                }
            }

            // Cập nhật trạng thái badge trên giao diện
            if (window.AppCore) {
                window.AppCore.setConnectionStatus(true, 'online');
                window.AppCore.showToast("🔥 Đã kết nối Firebase smarthome-75c59!", "success");
            }

            // Bắt đầu lắng nghe dữ liệu cảm biến thời gian thực (NhietDo, Doam,...)
            this.listenToAllNodes(onDataCallback);

            // Kiểm tra database khi kết nối
            this.checkAndSeedDatabase();

            return true;
        } catch (error) {
            console.error("❌ [Firebase] Lỗi kết nối Firebase smarthome-75c59:", error);
            if (window.AppCore) {
                window.AppCore.showToast("Lỗi kết nối Firebase: " + error.message, "error");
            }
            return false;
        }
    },

    /**
     * Lắng nghe dữ liệu cảm biến & thiết bị từ Firebase Realtime Database
     * Lắng nghe trực tiếp từ node gốc '/' để đọc tức thời mọi trường dữ liệu
     */
    listenToAllNodes: function(callback) {
        if (!this.db) return;

        const rootRef = this.db.ref();
        rootRef.on('value', (snapshot) => {
            const data = snapshot.val();
            console.log("🔥 [Firebase Realtime Data Received]:", data);
            if (data && typeof callback === 'function') {
                this.processReceivedData(data, callback);
            }
        }, (err) => {
            console.warn("⚠️ [Firebase] Lỗi đọc dữ liệu Realtime Database:", err);
        });
    },

    /**
     * Hàm quét và tìm giá trị linh hoạt từ data:
     * - Quét cả root lẫn các sub-objects (smarthome, DHT, sensors, cam_bien,...)
     * - Khớp không phân biệt hoa/thường, có hoặc không có dấu gạch dưới (NhietDo, Doam, nhiet_do, do_am,...)
     */
    findFieldValue: function(sources, keys) {
        const cleanKeys = keys.map(k => k.toLowerCase().replace(/[\s_\-]/g, ''));
        for (const src of sources) {
            if (!src || typeof src !== 'object') continue;
            // 1. Kiểm tra chính xác tên key (ưu tiên cao nhất)
            for (const key of keys) {
                if (src[key] !== undefined && src[key] !== null) return src[key];
            }
            // 2. Kiểm tra không phân biệt hoa/thường & dấu gạch dưới
            for (const objKey of Object.keys(src)) {
                const cleanKey = objKey.toLowerCase().replace(/[\s_\-]/g, '');
                if (cleanKeys.includes(cleanKey)) {
                    if (src[objKey] !== undefined && src[objKey] !== null) return src[objKey];
                }
            }
        }
        return undefined;
    },

    /**
     * Chuyển đổi an toàn chuỗi/số sang float/int
     */
    parseNumeric: function(val) {
        if (val === undefined || val === null || val === '') return null;
        if (typeof val === 'number') return isNaN(val) ? null : val;
        if (typeof val === 'string') {
            const cleaned = val.replace(/[^0-9.\-]/g, '');
            if (cleaned === '') return null;
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
        }
        return null;
    },

    /**
     * Chuyển đổi an toàn sang boolean
     */
    parseBoolean: function(val) {
        if (val === undefined || val === null || val === '') return null;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val > 0;
        if (typeof val === 'string') {
            const lower = val.trim().toLowerCase();
            return lower === 'true' || lower === '1' || lower === 'on' || lower === 'open' || lower === 'active';
        }
        return Boolean(val);
    },

    /**
     * Chuẩn hóa dữ liệu nhận được từ Firebase về State nội bộ
     * Đồng bộ chuẩn xác các trường thực tế như: NhietDo, Doam, gas, den, quat, cua,...
     */
    processReceivedData: function(data, callback) {
        if (!data) return;
        const normalized = {};

        // Gom tất cả các cấp object trong cây JSON (hỗ trợ mọi cấu trúc lồng nhau như NhaThongMinhV1 -> CamBien/DieuKhien)
        const sources = [];
        function collectSources(obj, depth = 0) {
            if (!obj || typeof obj !== 'object' || depth > 5) return;
            sources.push(obj);
            for (const k of Object.keys(obj)) {
                if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
                    collectSources(obj[k], depth + 1);
                }
            }
        }
        collectSources(data);

        // 1. NHIỆT ĐỘ (NhietDo, Nhiet_Do, nhiet_do, temp, temperature,...)
        const rawTemp = this.findFieldValue(sources, [
            'NhietDo', 'Nhiet_Do', 'nhiet_do', 'nhietdo', 'DoC', 
            'temp', 'temperature', 'Temperature', 'Nhiet', 'DHT11_NhietDo', 'DHT_NhietDo'
        ]);
        if (rawTemp !== undefined) {
            normalized.temp = this.parseNumeric(rawTemp);
        }

        // 2. ĐỘ ẨM (DoAm, Doam, Do_am, do_am, doam, hum, humidity,...)
        const rawHum = this.findFieldValue(sources, [
            'DoAm', 'Doam', 'Do_am', 'do_am', 'doam', 'hum', 
            'humidity', 'Humidity', 'DHT11_Doam', 'DHT_Doam'
        ]);
        if (rawHum !== undefined) {
            normalized.hum = this.parseNumeric(rawHum);
        }

        // 3. KHÍ GAS MQ2 (KhiGas, BaoDongGas, gas_phong_bep, GasBep, Gas,...)
        const rawGasKitchen = this.findFieldValue(sources, [
            'KhiGas', 'Khi_Gas', 'khi_gas', 'khigas', 'gas_phong_bep', 'GasBep', 'Gas_Bep', 'gasKitchen', 'gas', 'Gas', 'MQ2', 'mq2', 'GasMQ2'
        ]);
        if (rawGasKitchen !== undefined) {
            const num = this.parseNumeric(rawGasKitchen);
            normalized.gasKitchen = (num !== null) ? parseInt(num) : null;
            if (normalized.gasLiving === undefined) normalized.gasLiving = normalized.gasKitchen;
        }

        const rawGasLiving = this.findFieldValue(sources, [
            'gas_phong_khach', 'GasKhach', 'Gas_Khach', 'gasLiving', 'gas_living'
        ]);
        if (rawGasLiving !== undefined) {
            const num = this.parseNumeric(rawGasLiving);
            normalized.gasLiving = (num !== null) ? parseInt(num) : null;
            if (normalized.gasKitchen === undefined) normalized.gasKitchen = normalized.gasLiving;
        }

        const rawGasAlarm = this.findFieldValue(sources, [
            'BaoDongGas', 'bao_dong_gas', 'BaoDong', 'bao_dong'
        ]);
        if (rawGasAlarm !== undefined) {
            normalized.gasAlarm = this.parseBoolean(rawGasAlarm);
        }

        // 4. CẢM BIẾN CHUYỂN ĐỘNG & CHẾ ĐỘ PIR (CheDoPIR, PIR,...)
        const rawPir = this.findFieldValue(sources, [
            'pir_phong_khach', 'pir', 'PIR', 'Pir', 'ChuyenDong', 'chuyen_dong', 'motion', 'Motion'
        ]);
        if (rawPir !== undefined) {
            normalized.pirMotion = this.parseBoolean(rawPir);
        }

        const rawPirMode = this.findFieldValue(sources, [
            'CheDoPIR', 'che_do_pir', 'CheDo_PIR', 'pir_mode', 'pirMode'
        ]);
        if (rawPirMode !== undefined) {
            normalized.pirMode = this.parseBoolean(rawPirMode);
        }

        // 5. CẢM BIẾN MƯA (TroiMua, Mua, cam_bien_mua, rain,...)
        const rawRain = this.findFieldValue(sources, [
            'TroiMua', 'troi_mua', 'CamBienMua', 'cam_bien_mua', 'mua', 'Mua', 'rain', 'Rain', 'isRaining', 'is_raining'
        ]);
        if (rawRain !== undefined) {
            normalized.isRaining = this.parseBoolean(rawRain);
        }

        // 6. CỬA CHÍNH (MoCua: true = Mở, false = Khóa; 0/false: Khóa, 90/true: Mở)
        const rawDoor = this.findFieldValue(sources, [
            'MoCua', 'mo_cua', 'Mo_Cua', 'mocua', 'cua_chinh', 'CuaChinh', 'cua', 'Cua', 'door', 'Door', 'servo', 'Servo', 'KhoaCua'
        ]);
        if (rawDoor !== undefined) {
            if (rawDoor === 90 || rawDoor === true || rawDoor === '90' || String(rawDoor).toUpperCase() === 'OPEN' || String(rawDoor).toUpperCase() === 'TRUE') {
                normalized.doorLocked = false; // Đang Mở (Servo 90°)
            } else {
                normalized.doorLocked = true; // Đang Đóng/Khóa (Servo 0°)
            }
        }

        // 7. ĐÈN PHÒNG KHÁCH (DenKhach, DenPhongKhach,...)
        const rawLightLiving = this.findFieldValue(sources, [
            'DenKhach', 'den_khach', 'Den_Khach', 'denkhach', 'den_phong_khach', 'DenPhongKhach', 'den1', 'Den1', 'lightLiving', 'Den'
        ]);
        if (rawLightLiving !== undefined) normalized.lightLiving = this.parseBoolean(rawLightLiving);

        // 8. ĐÈN PHÒNG BẾP (DenBep, DenPhongBep,...)
        const rawLightKitchen = this.findFieldValue(sources, [
            'DenBep', 'den_bep', 'Den_Bep', 'denbep', 'den_phong_bep', 'DenPhongBep', 'den2', 'Den2', 'lightKitchen'
        ]);
        if (rawLightKitchen !== undefined) normalized.lightKitchen = this.parseBoolean(rawLightKitchen);

        // 9. QUẠT BẾP (QuatBep, quat,...)
        const rawFanKitchen = this.findFieldValue(sources, [
            'QuatBep', 'quat_bep', 'quat', 'Quat', 'fanKitchen', 'fan', 'Fan'
        ]);
        if (rawFanKitchen !== undefined) normalized.fanKitchen = this.parseBoolean(rawFanKitchen);

        // 10. ĐÈN PHÒNG NGỦ (DenNgu, DenPhongNgu,...)
        const rawLightBedroom = this.findFieldValue(sources, [
            'DenNgu', 'den_ngu', 'Den_Ngu', 'denngu', 'den_phong_ngu', 'DenPhongNgu', 'den3', 'Den3', 'lightBedroom'
        ]);
        if (rawLightBedroom !== undefined) normalized.lightBedroom = this.parseBoolean(rawLightBedroom);

        // 11. CÒI BÁO ĐỘNG KHẨN CẤP (CoiBaoDong,...)
        const rawAlarm = this.findFieldValue(sources, [
            'CoiBaoDong', 'coi_bao_dong', 'coi', 'Coi', 'bao_dong', 'alarm', 'Alarm', 'Buzzer'
        ]);
        if (rawAlarm !== undefined) normalized.alarmActive = this.parseBoolean(rawAlarm);

        // 12. GIÀN PHƠI
        const rawRackMode = this.findFieldValue(sources, ['gian_phoi_che_do', 'GianPhoiCheDo', 'rackMode']);
        if (rawRackMode !== undefined) normalized.rackMode = String(rawRackMode);

        const rawRackPos = this.findFieldValue(sources, ['gian_phoi_vi_tri', 'GianPhoiViTri', 'rackPosition', 'GianPhoi']);
        if (rawRackPos !== undefined) normalized.rackPosition = String(rawRackPos);

        // 13. NGƯỜI ĐIỀU KHIỂN GẦN NHẤT
        const rawOperator = this.findFieldValue(sources, ['nguoi_dieu_khien', 'NguoiDieuKhien', 'lastOperator']);
        if (rawOperator && typeof rawOperator === 'object' && window.AppCore && typeof window.AppCore.updateLastOperatorUI === 'function') {
            window.AppCore.updateLastOperatorUI(rawOperator);
        }

        callback(normalized);
    },

    /**
     * Gửi lệnh điều khiển lên Firebase Realtime Database
     * ĐÃ TỐI ƯU HÓA:
     * - Chỉ gửi trường thiết bị tương ứng (den_phong_khach, cua_chinh, quat_bep,...)
     * - Gửi kèm đối tượng 'nguoi_dieu_khien' để biết chính xác User nào đã dùng chức năng gì
     * - KHÔNG tạo bất kỳ nhánh 'smarthome' cồng kềnh lồng ghép nào nữa
     */
    sendDeviceCommand: async function(deviceId, action, extra = {}) {
        if (!this.db) return false;

        const timestamp = Date.now();
        const updates = {};

        const currentUser = (window.AppCore && window.AppCore.state && window.AppCore.state.currentUser) 
            ? window.AppCore.state.currentUser 
            : { name: "Chủ hộ", role: "admin" };

        const deviceNames = {
            'door': 'Cửa Chính (Servo 90°)',
            'light_living': 'Đèn Phòng Khách',
            'light_kitchen': 'Đèn Phòng Bếp',
            'fan_kitchen': 'Quạt Hút Bếp',
            'light_bedroom': 'Đèn Phòng Ngủ',
            'alarm': 'Còi Báo Động Khẩn Cấp',
            'rack_mode': 'Chế Độ Giàn Phơi',
            'rack': 'Giàn Phơi Đồ'
        };

        const actionNames = {
            'on': 'BẬT',
            'off': 'TẮT',
            'lock': 'KHÓA CỬA (0°)',
            'unlock': 'MỞ KHÓA (90°)',
            'auto': 'TỰ ĐỘNG',
            'manual': 'THỦ CÔNG',
            'extend': 'ĐƯA GIÀN RA',
            'retract': 'THU GIÀN VÀO'
        };

        const devName = deviceNames[deviceId] || deviceId;
        const actName = actionNames[action] || action;
        const timeFormatted = new Date().toLocaleTimeString('vi-VN') + ' - ' + new Date().toLocaleDateString('vi-VN');

        // 1. Cập nhật biến trạng thái thiết bị tương ứng (đồng bộ nhánh NhaThongMinhV1/DieuKhien và nhánh phẳng)
        switch (deviceId) {
            case 'door': {
                const isOpen = (action === 'unlock' || action === 'open' || action === 90);
                const val = isOpen ? 90 : 0;
                // Nhánh điều khiển phần cứng ESP32 NhaThongMinhV1
                updates['NhaThongMinhV1/DieuKhien/MoCua'] = isOpen;
                updates['MoCua'] = isOpen;
                // Nhánh phẳng tương thích
                updates['cua_chinh'] = val;
                updates['CuaChinh'] = val;
                break;
            }
            case 'light_living': {
                const val = (action === 'on');
                updates['NhaThongMinhV1/DieuKhien/DenKhach'] = val;
                updates['DenKhach'] = val;
                updates['den_phong_khach'] = val;
                updates['DenPhongKhach'] = val;
                break;
            }
            case 'light_kitchen': {
                const val = (action === 'on');
                updates['NhaThongMinhV1/DieuKhien/DenBep'] = val;
                updates['DenBep'] = val;
                updates['den_phong_bep'] = val;
                updates['DenPhongBep'] = val;
                break;
            }
            case 'fan_kitchen': {
                const val = (action === 'on');
                updates['NhaThongMinhV1/DieuKhien/QuatBep'] = val;
                updates['QuatBep'] = val;
                updates['quat_bep'] = val;
                break;
            }
            case 'light_bedroom': {
                const val = (action === 'on');
                updates['NhaThongMinhV1/DieuKhien/DenNgu'] = val;
                updates['DenNgu'] = val;
                updates['den_phong_ngu'] = val;
                updates['DenPhongNgu'] = val;
                break;
            }
            case 'alarm': {
                const val = (action === 'on');
                updates['NhaThongMinhV1/DieuKhien/CoiBaoDong'] = val;
                updates['CoiBaoDong'] = val;
                updates['coi_bao_dong'] = val;
                break;
            }
            case 'pir_mode':
            case 'pir': {
                const val = (action === 'on' || action === true);
                updates['NhaThongMinhV1/DieuKhien/CheDoPIR'] = val;
                updates['CheDoPIR'] = val;
                break;
            }
            case 'rack_mode': {
                updates['gian_phoi_che_do'] = action; // 'auto' | 'manual'
                updates['GianPhoiCheDo'] = action;
                break;
            }
            case 'rack': {
                const val = (action === 'extend') ? 'extended' : 'retracted';
                updates['gian_phoi_vi_tri'] = val;
                updates['GianPhoiViTri'] = val;
                break;
            }
        }

        // 2. Ghi nhận chính xác USER NÀO DÙNG CHỨC NĂNG GÌ vào Realtime Database
        updates['nguoi_dieu_khien'] = {
            ten: currentUser.name || "Chủ hộ",
            vai_tro: currentUser.role || "user",
            thiet_bi: devName,
            thao_tac: actName,
            thoi_gian: timeFormatted,
            timestamp: timestamp
        };

        try {
            // Ghi vào Realtime Database cho ESP32 và các máy khác nhận ngay
            await this.db.ref().update(updates);
            console.log(`🔥 [Realtime DB Tinh Gọn] Đã cập nhật [${deviceId}]:`, updates);

            // Cập nhật ngay trên giao diện nếu có hàm hiển thị
            if (window.AppCore && typeof window.AppCore.updateLastOperatorUI === 'function') {
                window.AppCore.updateLastOperatorUI(updates['nguoi_dieu_khien']);
            }

            // Ghi bản ghi chi tiết vào Cloud Firestore (collection: 'device_logs')
            await this.logDeviceActionToFirestore(deviceId, action, extra);

            return true;
        } catch (err) {
            console.error("❌ [Firebase] Ghi lệnh lên Firebase thất bại:", err);
            await this.logDeviceActionToFirestore(deviceId, action, extra);
            return false;
        }
    },

    /**
     * DỌN DẸP / XÓA BỎ NHÁNH 'smarthome' CŨ TRÊN FIREBASE REALTIME DATABASE
     * Đồng thời xóa sạch các thông số cảm biến giả lập để giữ nó rỗng
     * Đợi vi xử lý phần cứng tự cập nhật lên sau
     */
    cleanupOldSmarthomeTree: async function(silent = false) {
        if (!this.db) {
            if (!silent && window.AppCore) window.AppCore.showToast("Chưa kết nối Firebase Realtime Database!", "error");
            return false;
        }

        try {
            // 1. Kiểm tra và xóa vĩnh viễn nhánh 'smarthome'
            const smarthomeSnap = await this.db.ref('smarthome').once('value');
            if (smarthomeSnap.exists()) {
                console.log("🧹 [Firebase] Đang xóa nhánh 'smarthome' cồng kềnh khỏi Realtime Database...");
                await this.db.ref('smarthome').remove();
                console.log("✅ [Firebase] Đã xóa thành công nhánh 'smarthome'!");
            }

            // 2. Dọn sạch các trường dữ liệu cảm biến mẫu cũ (để rỗng hoàn toàn để phần cứng gửi lên)
            await this.clearSensorDummyValues(true);

            // 3. Khởi tạo trạng thái các công tắc thiết bị (đèn, cửa, giàn phơi)
            await this.seedLeanDatabase(true);

            if (!silent && window.AppCore) {
                window.AppCore.showToast("🧹 Đã dọn sạch Firebase: Xóa nhánh cũ và để rỗng cảm biến chờ phần cứng!", "success");
                window.AppCore.addLog("Đã dọn dẹp Firebase: Nhánh cũ đã xóa, cảm biến để rỗng chờ phần cứng gửi lên.", "cmd");
            }
            return true;
        } catch (err) {
            console.error("❌ [Firebase] Lỗi khi dọn dẹp nhánh smarthome:", err);
            if (!silent && window.AppCore) {
                window.AppCore.showToast("Lỗi dọn dẹp Firebase: " + err.message, "error");
            }
            return false;
        }
    },

    /**
     * Xóa các trường dữ liệu cảm biến mẫu trên Firebase để giữ nó rỗng
     * Đợi vi xử lý phần cứng tự cập nhật lên sau
     */
    clearSensorDummyValues: async function(silent = false) {
        if (!this.db) return false;
        try {
            const sensorFields = [
                'nhiet_do', 'do_am', 'gas_phong_khach', 'gas_phong_bep', 
                'pir_phong_khach', 'cam_bien_mua', 'temp', 'hum', 
                'gasLiving', 'gasKitchen', 'pir', 'rain'
            ];
            for (const field of sensorFields) {
                await this.db.ref(field).remove();
            }
            console.log("🧹 [Firebase] Đã dọn sạch các giá trị cảm biến mẫu, để rỗng để phần cứng gửi lên sau!");
            if (!silent && window.AppCore) {
                window.AppCore.showToast("Đã đưa các tham số cảm biến về rỗng, chờ vi xử lý cập nhật!", "success");
            }
            return true;
        } catch (err) {
            console.warn("⚠️ Lỗi khi xóa giá trị cảm biến:", err);
            return false;
        }
    },

    /**
     * Kiểm tra database khi khởi động:
     * - Kết nối an toàn, bảo toàn nguyên vẹn mọi trường dữ liệu người dùng đã tạo trong Firebase smarthome-75c59
     * - TUYỆT ĐỐI KHÔNG tự động xóa hay ghi đè trường của người dùng
     */
    checkAndSeedDatabase: async function() {
        if (!this.db) return;
        try {
            console.log("ℹ️ [Firebase] Đang kết nối và lắng nghe dữ liệu từ smarthome-75c59. Bảo toàn nguyên vẹn mọi trường dữ liệu.");
        } catch (err) {
            console.warn("⚠️ [Firebase] Kiểm tra database:", err);
        }
    },

    /**
     * Khởi tạo các công tắc thiết bị điều khiển ở cấp gốc
     * CHỈ khởi tạo các thiết bị điều khiển (đèn, khóa cửa, giàn phơi, còi)
     * KHÔNG tạo giá trị cảm biến mẫu, để nguyên cho phần cứng vi xử lý gửi lên sau
     */
    seedLeanDatabase: async function(silent = false) {
        if (!this.db) return false;

        const currentUser = (window.AppCore && window.AppCore.state && window.AppCore.state.currentUser) 
            ? window.AppCore.state.currentUser 
            : { name: "Nguyễn Văn An", role: "admin" };

        const leanDeviceSchema = {
            // Các thiết bị điều khiển trong nhà
            "den_phong_khach": false,
            "den_phong_bep": false,
            "quat_bep": false,
            "den_phong_ngu": false,
            "cua_chinh": 0,                // 0 độ: Khóa, 90 độ: Mở
            "gian_phoi_che_do": "auto",    // auto hoặc manual
            "gian_phoi_vi_tri": "extended",// extended hoặc retracted
            "coi_bao_dong": false,         // Còi hú khẩn cấp

            // Đồng bộ trực tiếp nhánh phần cứng NhaThongMinhV1/DieuKhien
            "NhaThongMinhV1/DieuKhien/MoCua": false,
            "NhaThongMinhV1/DieuKhien/DenKhach": false,
            "NhaThongMinhV1/DieuKhien/DenBep": false,
            "NhaThongMinhV1/DieuKhien/DenNgu": false,
            "NhaThongMinhV1/DieuKhien/CheDoPIR": true,

            // Trường ghi nhận Người dùng nào đang sử dụng chức năng gì
            "nguoi_dieu_khien": {
                "ten": currentUser.name || "Nguyễn Văn An",
                "vai_tro": currentUser.role || "admin",
                "thiet_bi": "Hệ Thống Nhà Thông Minh",
                "thao_tac": "SẴN SÀNG NHẬN DỮ LIỆU PHẦN CỨNG",
                "thoi_gian": new Date().toLocaleTimeString('vi-VN') + ' - ' + new Date().toLocaleDateString('vi-VN'),
                "timestamp": Date.now()
            }
        };

        try {
            await this.db.ref().update(leanDeviceSchema);
            console.log("✅ [Firebase] Đã đồng bộ các công tắc thiết bị, để rỗng cảm biến cho phần cứng vi xử lý!");
            if (!silent && window.AppCore) {
                window.AppCore.showToast("Đã đồng bộ công tắc thiết bị (Cảm biến để rỗng chờ phần cứng)!", "success");
            }
            return true;
        } catch (e) {
            console.error("❌ [Firebase] Lỗi khi tạo dữ liệu tối ưu:", e);
            return false;
        }
    },

    /**
     * Alias giữ tương thích cho nút bấm đồng bộ
     */
    seedAllFields: async function() {
        return this.seedLeanDatabase(false);
    },

    /**
     * =========================================================================
     * CLOUD FIRESTORE: QUẢN LÝ THÀNH VIÊN GIA ĐÌNH & PHÂN QUYỀN (ADMIN / USER)
     * Collection: 'family_members'
     * =========================================================================
     */

    /**
     * Lắng nghe danh sách thành viên gia đình thời gian thực từ Cloud Firestore
     */
    listenToFamilyMembers: function(callback) {
        if (!this.firestore) return;

        const membersRef = this.firestore.collection('family_members').orderBy('role', 'asc');
        membersRef.onSnapshot((querySnapshot) => {
            const members = [];
            querySnapshot.forEach((doc) => {
                members.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            console.log(`🔥 [Firestore] Đã tải ${members.length} thành viên gia đình từ Firestore.`);

            // Nếu Firestore collection trống, tự động tạo 3 thành viên gia đình mẫu
            if (members.length === 0) {
                this.seedDefaultFamilyMembers();
            } else if (typeof callback === 'function') {
                callback(members);
            }
        }, (error) => {
            console.warn("⚠️ [Firestore] Lỗi đọc collection family_members:", error);
        });
    },

    /**
     * Thêm thành viên mới vào Cloud Firestore
     */
    addFamilyMember: async function(memberData) {
        if (!this.firestore) {
            console.warn("Firestore chưa sẵn sàng, lưu tạm local.");
            return false;
        }

        try {
            const newMember = {
                name: memberData.name || "Thành viên mới",
                role: memberData.role || "user", // "admin" hoặc "user"
                relationship: memberData.relationship || "Thành viên gia đình",
                phone: memberData.phone || "",
                status: "online",
                avatarColor: memberData.avatarColor || "#2563eb",
                can_unlock_door: memberData.can_unlock_door !== undefined ? memberData.can_unlock_door : true,
                can_trigger_alarm: memberData.can_trigger_alarm !== undefined ? memberData.can_trigger_alarm : (memberData.role === 'admin'),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastActive: "Vừa xong"
            };

            const docRef = await this.firestore.collection('family_members').add(newMember);
            console.log("✅ [Firestore] Đã thêm thành viên mới với ID:", docRef.id);
            if (window.AppCore) {
                window.AppCore.showToast(`Đã thêm thành viên [${newMember.name}] lên Firestore!`, "success");
            }
            return docRef.id;
        } catch (error) {
            console.error("❌ [Firestore] Lỗi khi thêm thành viên:", error);
            if (window.AppCore) {
                window.AppCore.showToast("Lỗi thêm thành viên: " + error.message, "error");
            }
            return false;
        }
    },

    /**
     * Cập nhật thông tin / vai trò thành viên
     */
    updateFamilyMember: async function(id, updateData) {
        if (!this.firestore) return false;
        try {
            await this.firestore.collection('family_members').doc(id).update(updateData);
            console.log("✅ [Firestore] Đã cập nhật thành viên:", id);
            if (window.AppCore) {
                window.AppCore.showToast("Đã cập nhật thông tin thành viên trên Firestore!", "success");
            }
            return true;
        } catch (error) {
            console.error("❌ [Firestore] Lỗi cập nhật:", error);
            return false;
        }
    },

    /**
     * Xóa thành viên khỏi Cloud Firestore
     */
    deleteFamilyMember: async function(id, name) {
        if (!this.firestore) return false;
        try {
            await this.firestore.collection('family_members').doc(id).delete();
            console.log("✅ [Firestore] Đã xóa thành viên:", id);
            if (window.AppCore) {
                window.AppCore.showToast(`Đã xóa thành viên [${name || id}] khỏi Firestore!`, "warn");
            }
            return true;
        } catch (error) {
            console.error("❌ [Firestore] Lỗi xóa thành viên:", error);
            return false;
        }
    },

    /**
     * Ghi lịch sử mỗi lần bấm nút / điều khiển thiết bị vào Cloud Firestore
     * Collection: 'device_logs' & Document: 'device_states/latest'
     */
    logDeviceActionToFirestore: async function(deviceId, action, extra = {}) {
        if (!this.firestore) {
            console.warn("⚠️ [Cloud Firestore] Chưa kết nối Firestore.");
            return false;
        }

        const currentUser = (window.AppCore && window.AppCore.state && window.AppCore.state.currentUser) 
            ? window.AppCore.state.currentUser 
            : { name: "Người dùng", role: "user" };

        const deviceNames = {
            'door': 'Khóa Cửa Chính (Servo 90°)',
            'light_living': 'Đèn Phòng Khách',
            'light_kitchen': 'Đèn Phòng Bếp',
            'fan_kitchen': 'Quạt Hút Khói Bếp',
            'light_bedroom': 'Đèn Phòng Ngủ',
            'alarm': 'Còi Báo Động Khẩn Cấp',
            'rack_mode': 'Chế Độ Giàn Phơi',
            'rack': 'Giàn Phơi Đồ'
        };

        const actionNames = {
            'on': 'BẬT',
            'off': 'TẮT',
            'lock': 'KHÓA CỬA (0°)',
            'unlock': 'MỞ KHÓA (90°)',
            'auto': 'TỰ ĐỘNG',
            'manual': 'THỦ CÔNG',
            'extend': 'ĐƯA GIÀN RA',
            'retract': 'THU GIÀN VÀO'
        };

        const devName = deviceNames[deviceId] || deviceId;
        const actName = actionNames[action] || action;

        const logDoc = {
            user_id: currentUser.id || "admin_default",
            user_name: currentUser.name || "Chủ hộ",
            user_role: currentUser.role || "admin",
            device_id: deviceId,
            device_name: devName,
            action: action,
            action_label: actName,
            message: `${currentUser.name} (${currentUser.role === 'admin' ? 'Admin' : 'Thành viên'}) đã ${actName} ${devName}`,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            created_at_str: new Date().toLocaleTimeString('vi-VN') + ' - ' + new Date().toLocaleDateString('vi-VN')
        };

        try {
            console.log(`🔥 [Cloud Firestore] Ghi thao tác [${deviceId} -> ${action}] vào collection 'device_logs'...`);
            // 1. Ghi bản ghi vào collection 'device_logs'
            const docRef = await this.firestore.collection('device_logs').add(logDoc);
            console.log("✅ [Cloud Firestore] Đã lưu thành công vào Firestore với ID:", docRef.id);

            // 2. Ghi trạng thái hiện tại vào collection 'device_states', document 'latest'
            await this.firestore.collection('device_states').doc('latest').set({
                [deviceId]: action,
                last_device: devName,
                last_action: actName,
                last_user: currentUser.name,
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // 3. Cập nhật thao tác mới nhất của User vào collection 'family_members'
            if (currentUser.id && !currentUser.id.startsWith('local_')) {
                try {
                    await this.firestore.collection('family_members').doc(currentUser.id).set({
                        last_action: `${actName} ${devName}`,
                        lastActive: 'Vừa xong',
                        last_action_time: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                } catch (e) {
                    console.warn("⚠️ Cập nhật last_action cho member:", e);
                }
            }

            if (window.AppCore) {
                window.AppCore.showToast(`🔥 [Cloud Firestore] Đã ghi nhận: ${currentUser.name} ${actName} ${devName}`, 'success');
            }
            return true;
        } catch (error) {
            console.error("❌ [Cloud Firestore] Lỗi khi ghi vào Firestore:", error);
            if (window.AppCore) {
                if (error.code === 'permission-denied') {
                    window.AppCore.showToast("⚠️ Firebase Rule chặn ghi Firestore! Hãy vào Firebase Console -> Firestore -> Rules -> Cho phép 'allow read, write: if true;'", "error");
                }
            }
            return false;
        }
    },

    /**
     * Lắng nghe lịch sử bấm nút điều khiển từ Cloud Firestore collection 'device_logs'
     */
    listenToFirestoreDeviceLogs: function(callback) {
        if (!this.firestore) return;
        try {
            this.firestore.collection('device_logs').orderBy('timestamp', 'desc').limit(20)
                .onSnapshot((snapshot) => {
                    const logs = [];
                    snapshot.forEach(doc => {
                        logs.push({ id: doc.id, ...doc.data() });
                    });
                    if (typeof callback === 'function') {
                        callback(logs);
                    }
                }, err => {
                    console.warn("Lỗi đọc collection device_logs:", err);
                });
        } catch (e) {}
    },

    /**
     * Cập nhật trạng thái đăng nhập của thành viên lên Cloud Firestore
     */
    loginUserToFirestore: async function(member) {
        if (!this.firestore || !member) return;
        try {
            if (member.id && !member.id.startsWith('local_')) {
                await this.firestore.collection('family_members').doc(member.id).set({
                    name: member.name,
                    role: member.role || 'user',
                    relationship: member.relationship || 'Gia đình',
                    status: 'online',
                    lastActive: 'Đang hoạt động',
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            // Ghi nhật ký đăng nhập vào collection device_logs
            await this.firestore.collection('device_logs').add({
                user_id: member.id || "user",
                user_name: member.name,
                user_role: member.role || "user",
                device_id: "auth",
                device_name: "Hệ thống Đăng nhập",
                action: "login",
                action_label: "ĐĂNG NHẬP",
                message: `Thành viên ${member.name} (${member.relationship || 'Gia đình'}) đã đăng nhập vào hệ thống`,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                created_at_str: new Date().toLocaleTimeString('vi-VN') + ' - ' + new Date().toLocaleDateString('vi-VN')
            });
            console.log(`✅ [Firestore] Đã ghi nhận đăng nhập của ${member.name}`);
        } catch (e) {
            console.warn("Lỗi cập nhật đăng nhập Firestore (bỏ qua):", e);
        }
    },

    /**
     * Khởi tạo 3 thành viên gia đình mẫu mặc định trên Cloud Firestore
     */
    seedDefaultFamilyMembers: async function() {
        if (!this.firestore) return false;

        const defaults = [
            {
                name: "Nguyễn Văn An",
                role: "admin",
                relationship: "Chủ hộ / Bố",
                phone: "0912 345 678",
                status: "online",
                avatarColor: "#2563eb",
                can_unlock_door: true,
                can_trigger_alarm: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastActive: "Đang hoạt động"
            },
            {
                name: "Trần Thị Mai",
                role: "user",
                relationship: "Vợ / Mẹ",
                phone: "0987 654 321",
                status: "online",
                avatarColor: "#ec4899",
                can_unlock_door: true,
                can_trigger_alarm: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastActive: "5 phút trước"
            },
            {
                name: "Nguyễn Minh Khôi",
                role: "user",
                relationship: "Con trai",
                phone: "0901 234 567",
                status: "offline",
                avatarColor: "#10b981",
                can_unlock_door: true,
                can_trigger_alarm: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastActive: "Hôm qua 21:30"
            }
        ];

        try {
            console.log("ℹ️ [Firestore] Đang khởi tạo 3 thành viên gia đình mẫu...");
            const batch = this.firestore.batch();
            for (const member of defaults) {
                const docRef = this.firestore.collection('family_members').doc();
                batch.set(docRef, member);
            }
            await batch.commit();
            console.log("✅ [Firestore] Đã tạo thành công 3 thành viên gia đình mẫu trên Firestore!");
            return true;
        } catch (e) {
            console.warn("⚠️ [Firestore] Chưa thể tự động tạo mẫu (có thể do quy tắc bảo mật rules):", e);
            return false;
        }
    }
};

// Đưa ra window để truy cập toàn cục
window.SmartHomeFirebase = SmartHomeFirebase;
