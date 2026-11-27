# ระบบนำทางอาคารและแผนกบริการ โรงพยาบาลสกลนคร (Hospital Navigation System)

เว็บแอปพลิเคชันนำทางภายในโรงพยาบาลสกลนคร รองรับแผนที่ 3D (`MapLibre GL JS`), แผนที่ดาวเทียมและแผนที่ถนน (`Leaflet`), ระบบค้นหาอาคาร/แผนกแบบคำใกล้เคียง, GPS ติดตามตำแหน่งและเข็มทิศแบบเรียลไทม์, คำนวณเส้นทางเดิน (`Dijkstra + PostGIS`) และระบบจัดการสำหรับเจ้าหน้าที่ (Admin Map Editor 3D & GPS Field Survey)

---

## สิ่งที่ต้องติดตั้งบนเครื่อง (Prerequisites)

1. **PostgreSQL 14+** พร้อม **PostGIS Extension**
2. **Go 1.22+**
3. **Node.js 20+** (มาพร้อม `npm`)
4. **Git**

---

## ขั้นตอนติดตั้งและรันโปรเจกต์ตั้งแต่ต้น (สำหรับเครื่องใหม่)

### 1. ดาวน์โหลดโค้ดจาก Git
```bash
git clone https://github.com/sirawit6931/hospital-nav.git
cd hospital-nav
```

### 2. สร้างฐานข้อมูล PostgreSQL + PostGIS และตารางเริ่มต้น
สร้างฐานข้อมูลชื่อ `hospital_nav` แล้วรันไฟล์ `backend/schema.sql`:

```bash
psql -U postgres -c "CREATE DATABASE hospital_nav;"
psql -U postgres -d hospital_nav -f backend/schema.sql
```
*(หรือเปิด pgAdmin4 -> สร้างฐานข้อมูล `hospital_nav` -> เปิด Query Tool แล้วรันโค้ดในไฟล์ `backend/schema.sql`)*

### 3. ตั้งค่าและรัน Backend (Go + Gin, พอร์ต `8080`)
1. คัดลอกไฟล์ `.env.example` เป็น `.env`:
   - **Windows (PowerShell)**:
     ```powershell
     Copy-Item backend\.env.example backend\.env
     ```
   - **macOS / Linux**:
     ```bash
     cp backend/.env.example backend/.env
     ```
2. เปิดไฟล์ `backend/.env` แล้วแก้ไขรหัสผ่าน PostgreSQL (`DATABASE_URL`) และ `JWT_SECRET` ให้ตรงกับเครื่องของคุณ:
   ```env
   PORT=8080
   DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/hospital_nav?sslmode=disable
   JWT_SECRET=your_random_secret_key
   ```
3. รัน Backend:
   ```bash
   cd backend
   go mod tidy
   go run main.go
   ```
   > **อัตโนมัติเมื่อรันครั้งแรก**: ระบบจะสร้างบัญชีแอดมินตั้งต้น (`admin` / `admin1234`) และนำเข้าข้อมูลอาคารและเส้นทางเดินเริ่มต้นของโรงพยาบาลสกลนครลงฐานข้อมูลให้โดยอัตโนมัติ

### 4. ติดตั้งแพ็กเกจและรัน Frontend (Next.js, พอร์ต `3000`)
เปิด Terminal อีกหน้าต่าง แล้วรัน:
```bash
cd frontend
npm install
npm run dev
```
> หมายเหตุ: คำสั่ง `npm install` จะรันสคริปต์ `postinstall` เพื่อคัดลอกไฟล์ `public/maplibre-gl-csp-worker.js` สำหรับแผนที่ 3D ให้อัตโนมัติ

---

## การเข้าใช้งาน

- **หน้าผู้ป่วย / ผู้ใช้ทั่วไป**: `http://localhost:3000`
- **หน้าเจ้าหน้าที่ (Admin)**:
  - พิมพ์ URL `http://localhost:3000/admin/login` โดยตรง
  - หรือ **แตะที่โลโก้โรงพยาบาลสกลนครมุมซ้ายบนติดกัน 5 ครั้ง**
  - บัญชีเริ่มต้น: `admin` / `admin1234`
- **เก็บพิกัดภาคสนาม (GPS Survey)**: เข้าที่ `/admin/survey` (แนะนำเปิดผ่าน HTTPS เช่น Cloudflare Tunnel เมื่อใช้งานบนมือถือเพื่อให้เบราว์เซอร์อนุญาต GPS และเข็มทิศ)

---

## โครงสร้างโปรเจกต์
- `backend/` — Go API (Gin, GORM, PostgreSQL + PostGIS, Dijkstra routing, JWT Auth, 3D Overrides API)
- `frontend/` — Next.js 16 (React 19, TypeScript, Tailwind CSS v4, MapLibre GL JS 3D, Leaflet 2D)
- `frontend/public/data/sakon-hospital-3d.json` — ข้อมูลโมเดล 3D และขอบเขตโรงพยาบาลสกลนคร
