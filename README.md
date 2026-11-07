# Hệ Thống Nhà Thông Minh v1 - Tích Hợp Firebase Realtime Database

Dự án giao diện IoT **Nhà Thông Minh v1** đã được liên kết trực tiếp với dự án **Firebase Realtime Database** của bạn:
- **Project ID**: `iot-smarthome2-dbf39`
- **Database URL**: `https://iot-smarthome2-dbf39-default-rtdb.firebaseio.com`
- **Phong cách giao diện**: Nền ảnh biệt thự Smart Home hiện đại hiển thị rõ nét ở hậu cảnh, kết hợp phông màu sáng trang nhã, tối giản, không màu mè.

---

## 1. Cấu Trúc Toàn Bộ Các Trường Dữ Liệu Trên Firebase

Toàn bộ các cảm biến và thiết bị được thiết kế với tên trường tiếng Việt chuẩn, trực quan, dễ dàng đọc/ghi từ vi điều khiển **ESP32 / ESP8266 / Arduino**:

| Tên Trường (Firebase Key) | Kiểu Dữ Liệu | Nguồn Gửi Dữ Liệu | Ý Nghĩa / Chức Năng |
| :--- | :--- | :--- | :--- |
| `nhiet_do` | `number` (Float) | **Vi xử lý / Cảm biến DHT22** | Nhiệt độ môi trường (°C) - Để rỗng chờ MCU gửi |
| `do_am` | `number` (Float) | **Vi xử lý / Cảm biến DHT22** | Độ ẩm môi trường (%) - Để rỗng chờ MCU gửi |
| `gas_phong_khach` | `number` (Int) | **Vi xử lý / Cảm biến MQ2** | Khí Gas MQ2 phòng khách (PPM) - Để rỗng chờ MCU gửi |
| `gas_phong_bep` | `number` (Int) | **Vi xử lý / Cảm biến MQ2** | Khí Gas & khói MQ2 bếp (PPM) - Để rỗng chờ MCU gửi |
| `pir_phong_khach` | `boolean` | **Vi xử lý / Cảm biến PIR** | Cảm biến chuyển động (true: Có người, false: Trống) |
| `cam_bien_mua` | `boolean` | **Vi xử lý / Cảm biến mưa** | Cảm biến mưa sân phơi (true: Mưa, false: Khô) |
| `den_phong_khach` | `boolean` | Web điều khiển / MCU đọc | Bật / tắt đèn chiếu sáng phòng khách |
| `den_phong_bep` | `boolean` | Web điều khiển / MCU đọc | Bật / tắt đèn phòng bếp |
| `quat_bep` | `boolean` | Web điều khiển / MCU đọc | Bật / tắt quạt hút khói bếp |
| `den_phong_ngu` | `boolean` | Web điều khiển / MCU đọc | Bật / tắt đèn phòng ngủ |
| `cua_chinh` | `number` | Web điều khiển / MCU đọc | Góc quay Servo khóa cửa (0°: Khóa, 90°: Mở) |
| `gian_phoi_che_do` | `string` | Web điều khiển / MCU đọc | Chế độ giàn phơi: `"auto"` / `"manual"` |
| `gian_phoi_vi_tri` | `string` | Web điều khiển / MCU đọc | Vị trí giàn phơi: `"extended"` / `"retracted"` |
| `coi_bao_dong` | `boolean` | Web điều khiển / MCU đọc | Còi hú cảnh báo sự cố khẩn cấp |
| `nguoi_dieu_khien` | `object` | Web ghi nhận tự động | Ghi nhận chính xác User nào vừa điều khiển chức năng gì |

> **Cấu trúc dữ liệu đã được tối ưu tinh gọn & để rỗng cho phần cứng**:
> - **Các thông số cảm biến** (`nhiet_do`, `do_am`, `gas_phong_khach`, `gas_phong_bep`, `pir_phong_khach`, `cam_bien_mua`) **không tạo sẵn giá trị mẫu**, để rỗng hoàn toàn để vi xử lý phần cứng tự gửi lên sau.
> - Web sẽ lắng nghe thời gian thực (`on('value')`), khi vi xử lý phần cứng đẩy thông số lên Firebase thì giao diện sẽ hiển thị ngay tức thì. Khi chưa có dữ liệu, web hiển thị trạng thái chờ (`--`, `Chờ dữ liệu...`).
> - **Nhánh `smarthome` cũ** đã bị loại bỏ hoàn toàn. Khi người dùng điều khiển thiết bị, hệ thống chỉ cập nhật biến thiết bị đó và đối tượng `nguoi_dieu_khien`.

---

## 2. Dọn Dẹp / Xóa Bỏ Nhánh `smarthome` Cũ Trên Firebase (1 Click)

Nếu trong Firebase Realtime Database của bạn vẫn còn nhánh `smarthome` cồng kềnh trước đó:
1. Mở file [index.html](file:///d:/Appcode/vsc/DO_AN2/Web_smarthome/index.html).
2. Bấm vào nút màu đỏ nhạt trên thanh Header: **`🧹 Xóa Nhánh Cũ`** (hoặc nút **`🧹 Xóa Bỏ Nhánh 'smarthome' Cũ Trên Firebase`** ở bảng cuối trang).
3. Hệ thống sẽ tự động gửi lệnh `db.ref('smarthome').remove()` để dọn dẹp sạch sẽ nhánh thừa trên Firebase Realtime Database và đưa cơ sở dữ liệu về cấu trúc phẳng tinh gọn tối ưu.

---

## 3. Quản Lý Thành Viên Gia Đình Trên Cloud Firestore (Collection: `family_members`)

Hệ thống tích hợp trực tiếp **Cloud Firestore** để quản lý danh sách người dùng trong gia đình và phân quyền rõ ràng:
- **Trang quản lý**: [Thành Viên Gia Đình (users.html)](file:///d:/Appcode/vsc/DO_AN2/Web_smarthome/users.html)
- **Collection trên Firestore**: `family_members`
- **Các vai trò (Roles)**:
  - **Admin (Quản trị viên / Chủ hộ)**: Toàn quyền thêm, sửa, xóa thành viên gia đình, điều khiển tất cả thiết bị và kích hoạt còi báo động.
  - **User (Thành viên gia đình)**: Xem toàn bộ cảm biến, điều khiển các đèn và thiết bị trong nhà theo phân quyền được Admin cấp.

### Cấu Trúc Document Của Mỗi Thành Viên Trên Cloud Firestore:
```json
{
  "name": "Nguyễn Văn An",
  "role": "admin",
  "relationship": "Chủ hộ / Bố",
  "phone": "0912 345 678",
  "status": "online",
  "avatarColor": "#2563eb",
  "can_unlock_door": true,
  "can_trigger_alarm": true,
  "last_action": "BẬT Đèn Phòng Khách",
  "lastActive": "Vừa xong",
  "createdAt": "Timestamp"
}
```

> **Tính năng chuyển đổi người dùng**: Bạn có thể nhấp vào Badge người dùng ở góc trên bên phải Header trên bất kỳ trang nào để chuyển đổi qua lại giữa tài khoản Admin và các User khác trong gia đình để kiểm thử phân quyền ngay lập tức.

---

## 4. Cách Đồng Bộ / Khởi Tạo Dữ Liệu Tinh Gọn Lên Firebase

1. Mở file [index.html](file:///d:/Appcode/vsc/DO_AN2/Web_smarthome/index.html) bằng trình duyệt web.
2. Bấm vào nút **`🔥 Firebase: Đã Kết Nối`** ở Header hoặc nút **`🔥 Đồng Bộ Lên Firebase`**.
3. Hệ thống sẽ tự động cập nhật cấu trúc phẳng tối ưu lên Firebase Realtime Database của bạn. Bạn mở [Firebase Console](https://console.firebase.google.com/project/iot-smarthome2-dbf39/database) là thấy dữ liệu tinh gọn ngay lập tức!

---

## 5. Mã Nguồn Mẫu Nạp Cho ESP32 Giao Tiếp Với Firebase Này

Đoạn code C++ sử dụng thư viện phổ biến **FirebaseESP32** (tác giả Mobizt) để đọc cảm biến và nhận lệnh điều khiển:

```cpp
#include <WiFi.h>
#include <FirebaseESP32.h>
#include <DHT.h>

#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define DATABASE_URL "https://iot-smarthome2-dbf39-default-rtdb.firebaseio.com/"
#define DATABASE_SECRET "YOUR_DATABASE_SECRET" // Hoặc dùng API Key

#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

void setup() {
  Serial.begin(115200);
  dht.begin();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); }

  config.database_url = DATABASE_URL;
  config.signer.tokens.legacy_token = DATABASE_SECRET;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
}

unsigned long lastSend = 0;

void loop() {
  // 1. Cứ 3 giây đọc cảm biến và đẩy lên Firebase
  if (millis() - lastSend > 3000) {
    lastSend = millis();
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    int gasLiving = analogRead(34);
    int gasKitchen = analogRead(35);
    bool pir = digitalRead(14);
    bool rain = digitalRead(27);

    Firebase.setFloat(fbdo, "/nhiet_do", t);
    Firebase.setFloat(fbdo, "/do_am", h);
    Firebase.setInt(fbdo, "/gas_phong_khach", gasLiving);
    Firebase.setInt(fbdo, "/gas_phong_bep", gasKitchen);
    Firebase.setBool(fbdo, "/pir_phong_khach", pir);
    Firebase.setBool(fbdo, "/cam_bien_mua", rain);
  }

  // 2. Đọc lệnh điều khiển từ Web gửi xuống
  if (Firebase.getBool(fbdo, "/den_phong_khach")) {
    bool light1 = fbdo.boolData();
    digitalWrite(2, light1 ? HIGH : LOW); // Bật/tắt rơ-le đèn
  }

  if (Firebase.getInt(fbdo, "/cua_chinh")) {
    int servoAngle = fbdo.intData();
    // myServo.write(servoAngle); // 0 độ: Khóa, 90 độ: Mở
  }
}
```

---

## 6. Tùy Chỉnh Ảnh Nền Ngôi Nhà
- Đường dẫn ảnh nền hiện tại nằm ở dòng số 8 của file [css/style.css](file:///d:/Appcode/vsc/DO_AN2/Web_smarthome/css/style.css):
  ```css
  --bg-house-image: url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=2000&q=85');
  ```
- Lớp phủ mờ đã được giảm nhẹ xuống mức tối ưu (`0.22` - `0.32`), đảm bảo ảnh ngôi nhà phía sau hiển thị sắc nét, chi tiết trong khi các thẻ số liệu màu trắng mờ vẫn giữ được độ nổi khối và dễ đọc.
