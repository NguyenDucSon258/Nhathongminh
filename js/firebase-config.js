/**
 * =============================================================================
 * MODULE KẾT NỐI & ĐỒNG BỘ DỮ LIỆU ĐÁM MÂY VỚI FIREBASE REALTIME DATABASE
 * Dự Án: iot-smarthome2-dbf39
 * Hệ Thống Nhà Thông Minh v1
 * =============================================================================
 */

const SmartHomeFirebase = {
    // Đã kích hoạt kết nối với Firebase
    isFirebaseEnabled: true,

    // Cấu hình Firebase Project chính thức của bạn
    config: {
        apiKey: "AIzaSyCxKZlIkrIsEtH4MOScf79cYeVrtHVyWvQ",
        authDomain: "iot-smarthome2-dbf39.firebaseapp.com",
        databaseURL: "https://iot-smarthome2-dbf39-default-rtdb.firebaseio.com",
        projectId: "iot-smarthome2-dbf39",
        storageBucket: "iot-smarthome2-dbf39.firebasestorage.app",
        messagingSenderId: "1019090397705",
        appId: "1:1019090397705:web:93e8263094690d469d66d8",
        measurementId: "G-V0TXSS2KH2"
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
            this.db = firebase.database();
            this.isConnected = true;
            console.log("🔥 [Firebase] Đã kết nối Realtime Database: " + this.config.databaseURL);

            // 2. Kết nối Cloud Firestore (cho Quản lý Người dùng / Thành viên gia đình)
            if (typeof firebase.firestore === 'function') {
                this.firestore = firebase.firestore();
                console.log("🔥 [Cloud Firestore] Đã kết nối Cloud Firestore sẵn sàng quản lý thành viên gia đình!");
                this.listenToFamilyMembers((members) => {
                    this.familyMembers = members;
                    if (window.AppCore && typeof window.AppCore.onFamilyMembersUpdate === 'function') {
                        window.AppCore.onFamilyMembersUpdate(members);
                    }
                });
            }

            // Cập nhật trạng thái badge trên giao diện
            if (window.AppCore) {
                window.AppCore.setConnectionStatus(true, 'online');
                window.AppCore.showToast("🔥 Đã kết nối Firebase & Cloud Firestore!", "success");
            }

            // Bắt đầu lắng nghe dữ liệu cảm biến thời gian thực
            this.listenToAllNodes(onDataCallback);

            // Kiểm tra và khởi tạo dữ liệu mẫu nếu database đang trống
            this.checkAndSeedDatabase();

            return true;
        } catch (error) {
            console.error("❌ [Firebase] Lỗi kết nối Firebase:", error);
            if (window.AppCore) {
                window.AppCore.showToast("Lỗi kết nối Firebase: " + error.message, "error");
            }
            return false;
        }
    },

    /**
     * Lắng nghe dữ liệu cảm biến & thiết bị từ Firebase Realtime Database
     * Cấu trúc tối ưu: Chỉ đọc các trường gốc (Flat Root Fields) và đối tượng nguoi_dieu_khien
     * Loại bỏ hoàn toàn sự phụ thuộc vào nhánh cồng kềnh 'smarthome'
     */
    listenToAllNodes: function(callback) {
        if (!this.db) return;

        // Lắng nghe trực tiếp node gốc '/' (Nơi lưu các biến tinh gọn: nhiet_do, do_am, den_phong_khach, nguoi_dieu_khien...)
        const rootRef = this.db.ref();
        rootRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && typeof callback === 'function') {
                this.processReceivedData(data, callback);
            }
        }, (err) => {
            console.warn("⚠️ [Firebase] Lỗi đọc dữ liệu Realtime Database:", err);
        });
    },

    /**
     * Chuẩn hóa dữ liệu nhận được từ Firebase về State nội bộ
     * Nếu các trường cảm biến đang rỗng (chờ vi xử lý gửi lên), gán giá trị null để web hiển thị chờ
     */
    processReceivedData: function(data, callback) {
        if (!data) return;
        const normalized = {};

        // 1. Nhiệt độ & Độ ẩm (DHT22) - Vi xử lý phần cứng gửi lên
        if (data.nhiet_do !== undefined) {
            normalized.temp = (data.nhiet_do !== null && data.nhiet_do !== "" && !isNaN(data.nhiet_do)) ? parseFloat(data.nhiet_do) : null;
        } else if (data.temp !== undefined) {
            normalized.temp = (data.temp !== null && data.temp !== "" && !isNaN(data.temp)) ? parseFloat(data.temp) : null;
        }

        if (data.do_am !== undefined) {
            normalized.hum = (data.do_am !== null && data.do_am !== "" && !isNaN(data.do_am)) ? parseFloat(data.do_am) : null;
        } else if (data.hum !== undefined) {
            normalized.hum = (data.hum !== null && data.hum !== "" && !isNaN(data.hum)) ? parseFloat(data.hum) : null;
        }

        // 2. Cảm biến Gas MQ2 - Vi xử lý phần cứng gửi lên
        if (data.gas_phong_khach !== undefined) {
            normalized.gasLiving = (data.gas_phong_khach !== null && data.gas_phong_khach !== "" && !isNaN(data.gas_phong_khach)) ? parseInt(data.gas_phong_khach) : null;
        } else if (data.gasLiving !== undefined) {
            normalized.gasLiving = (data.gasLiving !== null && data.gasLiving !== "" && !isNaN(data.gasLiving)) ? parseInt(data.gasLiving) : null;
        }

        if (data.gas_phong_bep !== undefined) {
            normalized.gasKitchen = (data.gas_phong_bep !== null && data.gas_phong_bep !== "" && !isNaN(data.gas_phong_bep)) ? parseInt(data.gas_phong_bep) : null;
        } else if (data.gasKitchen !== undefined) {
            normalized.gasKitchen = (data.gasKitchen !== null && data.gasKitchen !== "" && !isNaN(data.gasKitchen)) ? parseInt(data.gasKitchen) : null;
        }

        // 3. Cảm biến chuyển động PIR
        if (data.pir_phong_khach !== undefined) {
            normalized.pirMotion = (data.pir_phong_khach !== null && data.pir_phong_khach !== "") ? Boolean(data.pir_phong_khach) : null;
        } else if (data.pir !== undefined) {
            normalized.pirMotion = (data.pir !== null && data.pir !== "") ? Boolean(data.pir) : null;
        }

        // 4. Cảm biến mưa
        if (data.cam_bien_mua !== undefined) {
            normalized.isRaining = (data.cam_bien_mua !== null && data.cam_bien_mua !== "") ? Boolean(data.cam_bien_mua) : null;
        } else if (data.rain !== undefined) {
            normalized.isRaining = (data.rain !== null && data.rain !== "") ? Boolean(data.rain) : null;
        }

        // 5. Cửa chính (Servo 90°)
        if (data.cua_chinh !== undefined) {
            // true/90 = mở, false/0 = đóng
            normalized.doorLocked = !(data.cua_chinh === true || data.cua_chinh === 90 || data.cua_chinh === "OPEN");
        }

        // 6. Đèn chiếu sáng
        if (data.den_phong_khach !== undefined) normalized.lightLiving = Boolean(data.den_phong_khach);
        if (data.den_phong_bep !== undefined) normalized.lightKitchen = Boolean(data.den_phong_bep);
        if (data.quat_bep !== undefined) normalized.fanKitchen = Boolean(data.quat_bep);
        if (data.den_phong_ngu !== undefined) normalized.lightBedroom = Boolean(data.den_phong_ngu);

        // 7. Còi báo động khẩn cấp
        if (data.coi_bao_dong !== undefined) normalized.alarmActive = Boolean(data.coi_bao_dong);

        // 8. Giàn phơi
        if (data.gian_phoi_che_do !== undefined) normalized.rackMode = data.gian_phoi_che_do;
        if (data.gian_phoi_vi_tri !== undefined) normalized.rackPosition = data.gian_phoi_vi_tri;

        // 9. Đồng bộ thông tin người điều khiển gần nhất (User nào dùng chức năng gì)
        if (data.nguoi_dieu_khien && window.AppCore && typeof window.AppCore.updateLastOperatorUI === 'function') {
            window.AppCore.updateLastOperatorUI(data.nguoi_dieu_khien);
        }

        // 10. Dữ liệu các Node / Phòng bổ sung tạo động từ phần cứng hoặc giao diện
        if (data.nodes && typeof data.nodes === 'object') {
            normalized.nodes = data.nodes;
        }
        if (data.rooms_config) {
            normalized.roomsConfig = data.rooms_config;
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

        // 1. Cập nhật duy nhất biến trạng thái thiết bị tương ứng
        switch (deviceId) {
            case 'door': {
                const isLocked = (action === 'lock');
                updates['cua_chinh'] = isLocked ? 0 : 90; // 0: Khóa, 90: Mở
                break;
            }
            case 'light_living': {
                updates['den_phong_khach'] = (action === 'on');
                break;
            }
            case 'light_kitchen': {
                updates['den_phong_bep'] = (action === 'on');
                break;
            }
            case 'fan_kitchen': {
                updates['quat_bep'] = (action === 'on');
                break;
            }
            case 'light_bedroom': {
                updates['den_phong_ngu'] = (action === 'on');
                break;
            }
            case 'alarm': {
                updates['coi_bao_dong'] = (action === 'on');
                break;
            }
            case 'rack_mode': {
                updates['gian_phoi_che_do'] = action; // 'auto' | 'manual'
                break;
            }
            case 'rack': {
                updates['gian_phoi_vi_tri'] = (action === 'extend') ? 'extended' : 'retracted';
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
     * Gửi lệnh điều khiển thiết bị thuộc một Node / Phòng mở rộng
     * Đường dẫn Realtime Database: /nodes/<nodeId>/<deviceKey>
     */
    sendNodeCommand: async function(nodeId, deviceKey, value) {
        if (!this.db) return false;
        try {
            const updates = {};
            updates[`nodes/${nodeId}/${deviceKey}`] = value;

            const currentUser = (window.AppCore && window.AppCore.state && window.AppCore.state.currentUser) 
                ? window.AppCore.state.currentUser 
                : { name: "Chủ hộ", role: "admin" };
            const timeFormatted = new Date().toLocaleTimeString('vi-VN') + ' - ' + new Date().toLocaleDateString('vi-VN');

            updates['nguoi_dieu_khien'] = {
                ten: currentUser.name || "Chủ hộ",
                vai_tro: currentUser.role || "user",
                thiet_bi: `Node ${nodeId} (${deviceKey})`,
                thao_tac: value ? "BẬT" : "TẮT",
                thoi_gian: timeFormatted,
                timestamp: Date.now()
            };

            await this.db.ref().update(updates);
            console.log(`🔥 [Realtime Node] Đã gửi lệnh Node [${nodeId}/${deviceKey}]: ${value}`);

            if (window.AppCore && typeof window.AppCore.updateLastOperatorUI === 'function') {
                window.AppCore.updateLastOperatorUI(updates['nguoi_dieu_khien']);
            }
            return true;
        } catch (err) {
            console.error("❌ [Firebase] Lỗi gửi lệnh Node:", err);
            return false;
        }
    },

    /**
     * Lưu cấu hình danh sách phòng động lên Firebase Realtime Database
     */
    saveRoomsConfig: async function(roomsConfig) {
        if (!this.db) return false;
        try {
            await this.db.ref('rooms_config').set(roomsConfig);
            return true;
        } catch (err) {
            console.warn("⚠️ [Firebase] Lỗi lưu rooms_config:", err);
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
     * - Nếu còn nhánh smarthome cũ, tự động dọn dẹp để tối ưu
     * - TUYỆT ĐỐI KHÔNG tự động tạo giá trị cảm biến mẫu (để rỗng chờ phần cứng gửi)
     */
    checkAndSeedDatabase: async function() {
        if (!this.db) return;
        try {
            // Nếu phát hiện còn nhánh smarthome cũ, tự động dọn dẹp
            const smarthomeSnap = await this.db.ref('smarthome').once('value');
            if (smarthomeSnap.exists()) {
                console.log("ℹ️ [Firebase] Phát hiện nhánh 'smarthome' cũ. Đang tự động dọn dẹp về cấu trúc tối ưu...");
                await this.cleanupOldSmarthomeTree(true);
            }
            // Không tạo giá trị cảm biến mẫu: để rỗng để phần cứng vi xử lý gửi lên sau
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
