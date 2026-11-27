package config

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"hospital-nav-backend/models"
)

// DB holds the shared GORM database connection instance.
var DB *gorm.DB

// ConnectDatabase establishes a connection to PostgreSQL using DATABASE_URL.
// Existing tables (including PostGIS columns) are preserved without running Drop or AutoMigrate.
func ConnectDatabase() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL environment variable is not set")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("failed to connect to PostgreSQL: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("failed to retrieve underlying sql.DB: %w", err)
	}

	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(50)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := sqlDB.Ping(); err != nil {
		return fmt.Errorf("failed to ping PostgreSQL: %w", err)
	}

	DB = db
	log.Println("Connected to PostgreSQL database successfully")
	return nil
}

// SeedDefaultAdmin inserts the default admin account (admin / admin1234) if it does not already exist.
func SeedDefaultAdmin() error {
	if DB == nil {
		return errors.New("database connection is not initialized")
	}

	const defaultUsername = "admin"
	const defaultPassword = "admin1234"

	var count int64
	if err := DB.Model(&models.Admin{}).Where("username = ?", defaultUsername).Count(&count).Error; err != nil {
		return fmt.Errorf("failed to check existing admin account: %w", err)
	}

	if count > 0 {
		log.Printf("Default admin %q already exists, skipping seed", defaultUsername)
		return nil
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(defaultPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash default admin password: %w", err)
	}

	admin := models.Admin{
		Username:     defaultUsername,
		PasswordHash: string(hashedPassword),
	}

	if err := DB.Select("Username", "PasswordHash").Create(&admin).Error; err != nil {
		return fmt.Errorf("failed to seed default admin account: %w", err)
	}

	log.Printf("Seeded default admin account %q successfully", defaultUsername)
	return nil
}

type seedNodeSpec struct {
	Key         string
	Name        string
	IsBuilding  bool
	Keywords    string
	IndoorGuide string
	Lat         float64
	Lng         float64
}

type seedEdgeSpec struct {
	FromKey     string
	ToKey       string
	Instruction string
	Wheelchair  bool
}

// InitialHospitalSeedData returns the official Sakon Nakhon Hospital buildings, walkway junctions,
// and walkable edges aligned 100% with the official hospital wall maps and public/data/sakon-hospital-3d.json.
func initialHospitalSeedData() ([]seedNodeSpec, []seedEdgeSpec) {
	initialNodes := []seedNodeSpec{
		// === Official Sakon Nakhon Hospital Buildings ===
		{
			Key:        "bldg_er_9f",
			Name:       "อาคารอุบัติเหตุฉุกเฉินและผู้ป่วยนอก (ตึก 9 ชั้น)",
			IsBuilding: true,
			Keywords:   "ER, อุบัติเหตุฉุกเฉิน, ผู้ป่วยนอก, OPD, คลินิกผิวหนัง, สูติ-นรีเวช, ตา, หู คอ จมูก, ENT, คัดกรอง, ประกันสังคม, ตึก 9 ชั้น",
			IndoorGuide: "ชั้น 1: ห้องอุบัติเหตุฉุกเฉิน (ER), จุดคัดกรอง, ประชาสัมพันธ์ และตรวจผู้ป่วยนอกทั่วไป\n" +
				"ชั้น 2: คลินิกโรคผิวหนัง\n" +
				"ชั้น 3: คลินิกสูติ-นรีเวชกรรม\n" +
				"ชั้น 4: คลินิกตา และคลินิกหู คอ จมูก (ENT)\n" +
				"ชั้น 5–9: หอผู้ป่วยอุบัติเหตุ หอผู้ป่วยวิกฤต และห้องประชุมภูริทัตโต (ชั้น 9)",
			Lat: 17.163853,
			Lng: 104.158522,
		},
		{
			Key:        "bldg_romyen_10f",
			Name:       "ตึก 10 ชั้น (ตึกร่มเย็น)",
			IsBuilding: true,
			Keywords:   "ตึกร่มเย็น, ร่มเย็น, ตึก 10 ชั้น, NICU, PICU, Sick Newborn, ทารกแรกเกิด, กุมารเวชกรรม 2, กุมารเวชกรรม 3, เด็ก, ตา, Eye Ward, หู คอ จมูก, ENT, นรีเวชกรรม, Gyno, สูติกรรมหลังคลอด, PP, หอผู้ป่วยพิเศษ, Special Ward",
			IndoorGuide: "ตั้งอยู่ฝั่งทิศใต้ของอาคารรังสีรักษา ติดทางเดินมีหลังคาแกนกลาง (ตรงข้ามตึกร่มธรรม):\n" +
				"ชั้น 1: หอผู้ป่วยวิกฤตทารกแรกเกิด 1, 2 (NICU)\n" +
				"ชั้น 2: หอผู้ป่วยวิกฤตเด็ก (PICU)\n" +
				"ชั้น 3: หอผู้ป่วยทารกแรกเกิดป่วย (Sick Newborn)\n" +
				"ชั้น 4: หอผู้ป่วยกุมารเวชกรรม 2\n" +
				"ชั้น 5: หอผู้ป่วยกุมารเวชกรรม 3\n" +
				"ชั้น 6: หอผู้ป่วยตา (Eye Ward)\n" +
				"ชั้น 7: หอผู้ป่วยหู คอ จมูก (ENT)\n" +
				"ชั้น 8: หอผู้ป่วยนรีเวชกรรม (Gyno)\n" +
				"ชั้น 9: หอผู้ป่วยสูติกรรมหลังคลอด (PP)\n" +
				"ชั้น 10: หอผู้ป่วยพิเศษ (Special Ward)",
			Lat: 17.163700,
			Lng: 104.157440,
		},
		{
			Key:        "bldg_romtham_8f",
			Name:       "ตึกร่มธรรม (ตึก 8 ชั้น)",
			IsBuilding: true,
			Keywords:   "ตึกร่มธรรม, ร่มธรรม, ตึก 8 ชั้น, หอผู้ป่วยใน, IPD, MICU, Stroke, Trauma, ห้องยาผู้ป่วยใน, อายุรกรรม, ศัลยกรรม",
			IndoorGuide: "ตั้งอยู่ติดด้านทิศใต้ของอาคารอุบัติเหตุฉุกเฉินฯ และเหนือลานจอดรถกลาง:\n" +
				"ชั้น G: ห้องยาผู้ป่วยใน และจุดบริการ\n" +
				"ชั้น 1–2: อายุรกรรม, MICU และ Stroke Unit\n" +
				"ชั้น 3–4: หอผู้ป่วยในอายุรกรรม และห้องพิเศษ\n" +
				"ชั้น 5–7: หอผู้ป่วยศัลยกรรม และ Trauma",
			Lat: 17.163440,
			Lng: 104.158260,
		},
		{
			Key:        "bldg_heart",
			Name:       "อาคารหัวใจเพื่อแผ่นดิน",
			IsBuilding: true,
			Keywords:   "อาคารหัวใจเพื่อแผ่นดิน, ตึกหัวใจเพื่อแผ่นดิน, จุดชำระเงิน, การเงิน, รับยา ชั้น 1, ห้องยา, ศูนย์หัวใจ, CICU, OR, ผ่าตัดหัวใจ, ฟอกไต, คลินิกนอกเวลา, SMC",
			IndoorGuide: "ตั้งอยู่ฝั่งทิศตะวันออกติดกับอาคารอุบัติเหตุฉุกเฉินและผู้ป่วยนอก:\n" +
				"ชั้น 1: จุดชำระเงิน (การเงิน), จุดรับยาผู้ป่วยนอก และลงทะเบียนศูนย์หัวใจ\n" +
				"ชั้น 2–3: หน่วยตรวจพิเศษโรคหัวใจ, คลินิกพิเศษนอกเวลาราชการ (SMC) และศูนย์ฟอกไต\n" +
				"ชั้น 4: ห้องผ่าตัดหัวใจ (OR) และหอผู้ป่วยวิกฤตโรคหัวใจ (CICU)",
			Lat: 17.163910,
			Lng: 104.159230,
		},
		{
			Key:        "bldg_radiology_mri",
			Name:       "อาคารรังสีรักษา / ศูนย์ MRI",
			IsBuilding: true,
			Keywords:   "อาคารรังสีรักษา, รังสีรักษา, ศูนย์ MRI, MRI, CT Scan, เอกซเรย์, รังสีวิทยา, เวชศาสตร์นิวเคลียร์",
			IndoorGuide: "ตั้งอยู่ฝั่งทิศตะวันตกของอาคารอุบัติเหตุฉุกเฉินฯ และเหนือตึกร่มเย็น:\n" +
				"ชั้น 1: ศูนย์ตรวจ MRI และเครื่องเอกซเรย์คอมพิวเตอร์ (CT Scan)\n" +
				"ชั้น 2–4: หน่วยรังสีรักษาและเวชศาสตร์นิวเคลียร์",
			Lat: 17.164340,
			Lng: 104.157840,
		},
		{
			Key:         "bldg_surgery_delivery",
			Name:        "อาคารศัลยกรรม คลอดผ่าตัด",
			IsBuilding:  true,
			Keywords:    "อาคารศัลยกรรม, คลอดผ่าตัด, ห้องคลอด, ผ่าตัด, ศัลยกรรม, OR, สูติกรรม",
			IndoorGuide: "ตั้งอยู่ทางทิศใต้ของตึกร่มเย็นและอาคารพัสดุ เชื่อมต่อตรงกับทางเดินมีหลังคาแกนกลาง",
			Lat:         17.163050,
			Lng:         104.157260,
		},
		{
			Key:         "bldg_analysis_therapy",
			Name:        "อาคารวิเคราะห์ วิจัย บำบัด",
			IsBuilding:  true,
			Keywords:    "อาคารวิเคราะห์ วิจัย บำบัด, ห้องปฏิบัติการ, แล็บ, Lab, ตรวจเลือด, เจาะเลือด, วิเคราะห์, บำบัด",
			IndoorGuide: "ตั้งอยู่บริเวณทางเข้าฝั่งถนนเจริญเมือง ติดกับโบสถ์หลวงพ่อองค์ดำและอาคารไตเทียมเอกชน",
			Lat:         17.161500,
			Lng:         104.157680,
		},
		{
			Key:         "bldg_capd_xray",
			Name:        "อาคารล้างไตทางช่องท้อง / เอ็กซ์เรย์",
			IsBuilding:  true,
			Keywords:    "ล้างไตทางช่องท้อง, ล้างไต, CAPD, เอ็กซ์เรย์, เอกซเรย์, X-Ray",
			IndoorGuide: "ตั้งอยู่หัวมุมทิศตะวันตกเฉียงใต้ฝั่งถนนเจริญเมือง ให้บริการล้างไตทางช่องท้องและเอ็กซ์เรย์ทั่วไป",
			Lat:         17.161760,
			Lng:         104.156962,
		},
		{
			Key:         "bldg_private_dialysis",
			Name:        "อาคารไตเทียมเอกชน",
			IsBuilding:  true,
			Keywords:    "ไตเทียมเอกชน, ฟอกไต, ล้างไต, Hemodialysis",
			IndoorGuide: "ตั้งอยู่ติดถนนเจริญเมือง ใกล้โบสถ์หลวงพ่อองค์ดำและอาคารวิเคราะห์ วิจัย บำบัด",
			Lat:         17.161327,
			Lng:         104.157417,
		},
		{
			Key:         "bldg_pharmacy",
			Name:        "อาคารเภสัชกรรม",
			IsBuilding:  true,
			Keywords:    "อาคารเภสัชกรรม, เภสัชกรรม, ห้องยา, จ่ายยา, คลังยา",
			IndoorGuide: "ตั้งอยู่โซนกลางใต้ถัดจากลานจอดรถกลาง ใกล้กับอาคารผู้ป่วยกุมารเวชกรรม 1, 2 และศูนย์เครื่องมือแพทย์",
			Lat:         17.162620,
			Lng:         104.158010,
		},
		{
			Key:         "bldg_physio_thai",
			Name:        "อาคารกายภาพบำบัด / แพทย์แผนไทย",
			IsBuilding:  true,
			Keywords:    "กายภาพบำบัด, เวชศาสตร์ฟื้นฟู, แพทย์แผนไทย, นวดแผนไทย, ฝึกเดิน",
			IndoorGuide: "ตั้งอยู่โซนฝั่งตะวันออก ใกล้กับอาคารร่มฟ้าและงานจ่ายกลาง รองรับทางลาดรถเข็นตลอดแนว",
			Lat:         17.162440,
			Lng:         104.158420,
		},
		{
			Key:         "bldg_phra_ajan_fan",
			Name:        "อาคารพระอาจารย์ฝั้น อาจาโร",
			IsBuilding:  true,
			Keywords:    "อาคารพระอาจารย์ฝั้น อาจาโร, พระอาจารย์ฝั้น, หอผู้ป่วย",
			IndoorGuide: "ตั้งอยู่โซนกลางใต้ ใกล้กับอาคารผู้ป่วยหนักเด็ก (PICU/NICU 2) และอาคารกุมารเวชกรรม 3",
			Lat:         17.162146,
			Lng:         104.157374,
		},
		{
			Key:         "bldg_rompho",
			Name:        "อาคารร่มโพธิ์",
			IsBuilding:  true,
			Keywords:    "อาคารร่มโพธิ์, ร่มโพธิ์, กายอุปกรณ์, ศัลยกรรมกระดูก, ใจสว่าง, ประชุม, ฝึกอบรม",
			IndoorGuide: "ตั้งอยู่โซนตะวันออกเฉียงใต้ติดลานจอดรถฝั่งใต้ ใกล้กับอาคารกายอุปกรณ์และอาคารศัลยกรรมกระดูก",
			Lat:         17.161477,
			Lng:         104.158504,
		},
		{
			Key:         "bldg_ent_sicu",
			Name:        "อาคารผู้ป่วย ตา หู คอ จมูก / ผู้ป่วยหนักศัลยกรรม",
			IsBuilding:  true,
			Keywords:    "ตา, หู คอ จมูก, ผู้ป่วยหนักศัลยกรรม, SICU, งานทันตกรรม, งานกิจการภาพ",
			IndoorGuide: "ตั้งอยู่โซนฝั่งตะวันตกติดด้านทิศใต้ของอาคารศัลยกรรม คลอดผ่าตัด",
			Lat:         17.162550,
			Lng:         104.157180,
		},
		{
			Key:         "bldg_doklamduan",
			Name:        "อาคารดอกลำดวน / อาชีวอนามัย / ห้องสมุด คลังเภสัชกรรม",
			IsBuilding:  true,
			Keywords:    "อาคารดอกลำดวน, งานทันตกรรม, งานกิจการภาพ, อาชีวอนามัย, ห้องสมุด, คลังเภสัชกรรม",
			IndoorGuide: "ตั้งอยู่โซนตะวันตกเฉียงใต้ ถัดจากอาคารผู้ป่วย ตา หู คอ จมูก",
			Lat:         17.162276,
			Lng:         104.156996,
		},
		{
			Key:         "bldg_micu1_obgyn",
			Name:        "อาคารผู้ป่วยหนัก (MICU 1) / สูตินรีเวช",
			IsBuilding:  true,
			Keywords:    "MICU 1, อาคารผู้ป่วยหนัก, อาคารผู้ป่วยสูตินรีเวช, สูตินรีเวช",
			IndoorGuide: "ตั้งอยู่ติดด้านทิศใต้ของลานจอดรถกลาง เหนืออาคารผู้ป่วยหนักเด็ก (PICU/NICU 2)",
			Lat:         17.162760,
			Lng:         104.157550,
		},
		{
			Key:         "bldg_picu_nicu2",
			Name:        "อาคารผู้ป่วยหนักเด็ก (PICU / NICU 2)",
			IsBuilding:  true,
			Keywords:    "PICU, NICU 2, อาคารผู้ป่วยหนักเด็ก, เด็ก",
			IndoorGuide: "ตั้งอยู่โซนกลางใต้ ติดกับอาคารผู้ป่วยสูตินรีเวชและอาคารพระอาจารย์ฝั้น อาจาโร",
			Lat:         17.162490,
			Lng:         104.157570,
		},
		{
			Key:         "bldg_pediatrics_12",
			Name:        "อาคารผู้ป่วยกุมารเวชกรรม 1, 2",
			IsBuilding:  true,
			Keywords:    "กุมารเวชกรรม 1, กุมารเวชกรรม 2, อาคารผู้ป่วยกุมารเวชกรรม, เด็ก",
			IndoorGuide: "ตั้งอยู่ติดด้านทิศใต้ของอาคารเภสัชกรรม",
			Lat:         17.162280,
			Lng:         104.157980,
		},
		{
			Key:         "bldg_med_equip_cssd",
			Name:        "ศูนย์เครื่องมือแพทย์ / งานจ่ายกลาง",
			IsBuilding:  true,
			Keywords:    "ศูนย์เครื่องมือแพทย์, งานจ่ายกลาง, ศูนย์จ่ายกลาง, CSSD",
			IndoorGuide: "ตั้งอยู่ฝั่งตะวันออกของอาคารเภสัชกรรม ใกล้งานซักฟอก",
			Lat:         17.162540,
			Lng:         104.158300,
		},
		{
			Key:         "bldg_romfah",
			Name:        "อาคารร่มฟ้า",
			IsBuilding:  true,
			Keywords:    "อาคารร่มฟ้า, ตึกร่มฟ้า, ร่มฟ้า",
			IndoorGuide: "ตั้งอยู่โซนตะวันออก ใต้อาคารกายภาพบำบัด / แพทย์แผนไทย",
			Lat:         17.162020,
			Lng:         104.158480,
		},
		{
			Key:         "bldg_romchat",
			Name:        "อาคารร่มฉัตร",
			IsBuilding:  true,
			Keywords:    "อาคารร่มฉัตร, ตึกร่มฉัตร, ร่มฉัตร, เรือนพักญาติ",
			IndoorGuide: "ตั้งอยู่ติดฝั่งตะวันออกของอาคารร่มฟ้า ใกล้เรือนพักญาติ",
			Lat:         17.161920,
			Lng:         104.158680,
		},
		{
			Key:         "bldg_ortho_jaisawang",
			Name:        "อาคารผู้ป่วยศัลยกรรมกระดูก / ใจสว่าง",
			IsBuilding:  true,
			Keywords:    "ศัลยกรรมกระดูก, ใจสว่าง, ผู้ป่วยศัลยกรรมกระดูก, กระดูก, ออร์โธปิดิกส์",
			IndoorGuide: "ตั้งอยู่ติดฝั่งตะวันออกของอาคารร่มโพธิ์ ใกล้อาคารกายอุปกรณ์",
			Lat:         17.161640,
			Lng:         104.158720,
		},
		{
			Key:         "bldg_prosthetics",
			Name:        "อาคารกายอุปกรณ์",
			IsBuilding:  true,
			Keywords:    "อาคารกายอุปกรณ์, กายอุปกรณ์, แขนขาเทียม",
			IndoorGuide: "ตั้งอยู่โซนตะวันออกเฉียงใต้ ใกล้อาคารศัลยกรรมกระดูกและอาคารร่มโพธิ์",
			Lat:         17.161300,
			Lng:         104.158720,
		},
		{
			Key:         "bldg_boht_ongdam",
			Name:        "โบสถ์หลวงพ่อองค์ดำ",
			IsBuilding:  true,
			Keywords:    "โบสถ์หลวงพ่อองค์ดำ, หลวงพ่อองค์ดำ, หอพระ",
			IndoorGuide: "ตั้งอยู่โซนทิศใต้ใกล้ถนนเจริญเมือง ระหว่างอาคารไตเทียมเอกชนและอาคารวิเคราะห์ วิจัย บำบัด",
			Lat:         17.161923,
			Lng:         104.157323,
		},

		// === Key Walkway Junctions & Hospital Entrances (is_building = false) ===
		{Key: "j_gate_north", Name: "ประตูทางเข้าหลัก (ฝั่งหนองหาร)", IsBuilding: false, Lat: 17.165050, Lng: 104.158180},
		{Key: "j_gate_er", Name: "ทางเข้าฉุกเฉิน / ลานจอดรถเหนือ", IsBuilding: false, Lat: 17.165020, Lng: 104.159020},
		{Key: "j_north_plaza", Name: "แยกหน้าอาคารอุบัติเหตุฉุกเฉินฯ", IsBuilding: false, Lat: 17.164340, Lng: 104.158450},
		{Key: "j_walkway_north", Name: "ทางเชื่อมมีหลังคาเหนือ (รังสีรักษา / ตึก 9 ชั้น)", IsBuilding: false, Lat: 17.164180, Lng: 104.158080},
		{Key: "j_er_heart_link", Name: "ทางเชื่อมตึกอุบัติเหตุฯ – อาคารหัวใจเพื่อแผ่นดิน", IsBuilding: false, Lat: 17.163880, Lng: 104.158880},
		{Key: "j_er_romtham_link", Name: "ทางเชื่อมตึกอุบัติเหตุฯ – ตึกร่มธรรม (8 ชั้น)", IsBuilding: false, Lat: 17.163660, Lng: 104.158380},
		{Key: "j_walkway_mid", Name: "ทางเดินมีหลังคาแกนกลาง (ร่มเย็น / ร่มธรรม)", IsBuilding: false, Lat: 17.163660, Lng: 104.157860},
		{Key: "j_walkway_south", Name: "ทางเดินมีหลังคาใต้ (ลานจอดรถกลาง / ศัลยกรรม คลอดผ่าตัด)", IsBuilding: false, Lat: 17.162920, Lng: 104.157580},
		{Key: "j_central_south", Name: "แยกโซนกลางใต้ (เภสัชกรรม / กายภาพฯ / พระอาจารย์ฝั้น)", IsBuilding: false, Lat: 17.162450, Lng: 104.157480},
		{Key: "j_south_plaza", Name: "แยกหน้าโบสถ์หลวงพ่อองค์ดำ / ถนนเจริญเมือง", IsBuilding: false, Lat: 17.161620, Lng: 104.157400},
		{Key: "j_south_parking", Name: "แยกหน้าลานจอดรถฝั่งใต้ / อาคารร่มโพธิ์", IsBuilding: false, Lat: 17.161760, Lng: 104.158170},
	}

	initialEdges := []seedEdgeSpec{
		// North entrances -> ตึก 9 ชั้น (ER/OPD), รังสีรักษา / ศูนย์ MRI
		{FromKey: "j_gate_north", ToKey: "j_north_plaza", Instruction: "เดินตรงจากประตูหลักมุ่งหน้าอาคารอุบัติเหตุฉุกเฉินและผู้ป่วยนอก", Wheelchair: true},
		{FromKey: "j_gate_er", ToKey: "j_north_plaza", Instruction: "เข้าทางประตูฉุกเฉินผ่านหน้าลานจอดรถเหนือสู่ตึก 9 ชั้น", Wheelchair: true},
		{FromKey: "j_north_plaza", ToKey: "bldg_er_9f", Instruction: "เข้าสู่อาคารอุบัติเหตุฉุกเฉินและผู้ป่วยนอก (ตึก 9 ชั้น)", Wheelchair: true},
		{FromKey: "j_north_plaza", ToKey: "j_walkway_north", Instruction: "เดินตามทางเดินมีหลังคาไปฝั่งตะวันตก (อาคารรังสีรักษา)", Wheelchair: true},
		{FromKey: "j_walkway_north", ToKey: "bldg_radiology_mri", Instruction: "เข้าสู่อาคารรังสีรักษา / ศูนย์ MRI", Wheelchair: true},
		{FromKey: "j_walkway_north", ToKey: "bldg_er_9f", Instruction: "เดินเชื่อมเข้าสู่อาคารอุบัติเหตุฉุกเฉินและผู้ป่วยนอก", Wheelchair: true},

		// Core Covered Walkway Hub: ตึก 9 ชั้น <-> อาคารหัวใจเพื่อแผ่นดิน <-> ตึกร่มธรรม (8 ชั้น) <-> ตึกร่มเย็น (10 ชั้น)
		{FromKey: "bldg_er_9f", ToKey: "j_er_heart_link", Instruction: "เดินผ่านทางเชื่อมมีหลังคาจากตึก 9 ชั้น ไปอาคารหัวใจเพื่อแผ่นดิน", Wheelchair: true},
		{FromKey: "j_er_heart_link", ToKey: "bldg_heart", Instruction: "เข้าสู่ชั้น 1 อาคารหัวใจเพื่อแผ่นดิน (จุดชำระเงิน / รับยา / ศูนย์หัวใจ)", Wheelchair: true},
		{FromKey: "bldg_er_9f", ToKey: "j_er_romtham_link", Instruction: "เดินตามทางเชื่อมมีหลังคาจากตึก 9 ชั้น มายังตึกร่มธรรม (8 ชั้น)", Wheelchair: true},
		{FromKey: "j_er_romtham_link", ToKey: "bldg_romtham_8f", Instruction: "เข้าสู่โถงชั้นล่าง ตึกร่มธรรม (ตึก 8 ชั้น)", Wheelchair: true},

		// Central Covered Walkway Spine: รังสีรักษา -> ตึกร่มเย็น (10 ชั้น) / ตึกร่มธรรม (8 ชั้น) -> ศัลยกรรม คลอดผ่าตัด
		{FromKey: "j_walkway_north", ToKey: "j_walkway_mid", Instruction: "เดินตรงตามทางเดินมีหลังคาแกนกลางโรงพยาบาล", Wheelchair: true},
		{FromKey: "j_walkway_mid", ToKey: "bldg_romyen_10f", Instruction: "เข้าสู่โถงชั้น 1 ตึก 10 ชั้น (ตึกร่มเย็น)", Wheelchair: true},
		{FromKey: "j_walkway_mid", ToKey: "bldg_romtham_8f", Instruction: "ข้ามทางเดินมีหลังคาเข้าสู่ตึกร่มธรรม (ตึก 8 ชั้น)", Wheelchair: true},
		{FromKey: "j_walkway_mid", ToKey: "j_walkway_south", Instruction: "เดินตรงตามทางเดินมีหลังคาแกนกลางลงมาทางทิศใต้", Wheelchair: true},
		{FromKey: "j_walkway_south", ToKey: "bldg_surgery_delivery", Instruction: "เลี้ยวเข้าสู่อาคารศัลยกรรม คลอดผ่าตัด", Wheelchair: true},
		{FromKey: "j_walkway_south", ToKey: "bldg_romtham_8f", Instruction: "เดินผ่านลานจอดรถกลางขึ้นไปยังตึกร่มธรรม (ตึก 8 ชั้น)", Wheelchair: true},

		// Mid-South Zone: เภสัชกรรม, กายภาพบำบัด/แพทย์แผนไทย, พระอาจารย์ฝั้น อาจาโร, MICU/PICU, กุมารฯ, ร่มฟ้า, ร่มฉัตร
		{FromKey: "j_walkway_south", ToKey: "bldg_micu1_obgyn", Instruction: "เดินเข้าสู่อาคารผู้ป่วยหนัก (MICU 1) / สูตินรีเวช", Wheelchair: true},
		{FromKey: "j_walkway_south", ToKey: "j_central_south", Instruction: "เดินตามทางเดินหลักลงมาโซนอาคารผู้ป่วยกลางใต้", Wheelchair: true},
		{FromKey: "j_central_south", ToKey: "bldg_ent_sicu", Instruction: "เลี้ยวขวาเข้าสู่อาคารผู้ป่วย ตา หู คอ จมูก / ผู้ป่วยหนักศัลยกรรม", Wheelchair: true},
		{FromKey: "bldg_ent_sicu", ToKey: "bldg_doklamduan", Instruction: "เดินต่อไปยังอาคารดอกลำดวน / อาชีวอนามัย / ห้องสมุด", Wheelchair: true},
		{FromKey: "j_central_south", ToKey: "bldg_picu_nicu2", Instruction: "เข้าสู่อาคารผู้ป่วยหนักเด็ก (PICU / NICU 2)", Wheelchair: true},
		{FromKey: "j_central_south", ToKey: "bldg_pharmacy", Instruction: "เลี้ยวเข้าสู่อาคารเภสัชกรรม", Wheelchair: true},
		{FromKey: "bldg_pharmacy", ToKey: "bldg_med_equip_cssd", Instruction: "เดินต่อไปยังศูนย์เครื่องมือแพทย์ / งานจ่ายกลาง", Wheelchair: true},
		{FromKey: "bldg_pharmacy", ToKey: "bldg_pediatrics_12", Instruction: "เดินลงมาทางทิศใต้เข้าสู่อาคารผู้ป่วยกุมารเวชกรรม 1, 2", Wheelchair: true},
		{FromKey: "bldg_med_equip_cssd", ToKey: "bldg_physio_thai", Instruction: "เดินเชื่อมต่อไปยังอาคารกายภาพบำบัด / แพทย์แผนไทย", Wheelchair: true},
		{FromKey: "bldg_physio_thai", ToKey: "bldg_romfah", Instruction: "เดินลงมาเข้าสู่อาคารร่มฟ้า", Wheelchair: true},
		{FromKey: "bldg_romfah", ToKey: "bldg_romchat", Instruction: "เดินเชื่อมต่อไปยังอาคารร่มฉัตร", Wheelchair: true},
		{FromKey: "j_central_south", ToKey: "bldg_phra_ajan_fan", Instruction: "เข้าสู่อาคารพระอาจารย์ฝั้น อาจาโร", Wheelchair: true},

		// South Zone (ถนนเจริญเมือง): โบสถ์หลวงพ่อองค์ดำ, วิเคราะห์ วิจัย บำบัด, ล้างไต/X-Ray, ไตเทียมเอกชน, อาคารร่มโพธิ์, กระดูก/กายอุปกรณ์
		{FromKey: "j_central_south", ToKey: "j_south_plaza", Instruction: "เดินตรงลงมาทางทิศใต้ผ่านโบสถ์หลวงพ่อองค์ดำสู่ฝั่งถนนเจริญเมือง", Wheelchair: true},
		{FromKey: "j_south_plaza", ToKey: "bldg_boht_ongdam", Instruction: "เข้าสู่บริเวณโบสถ์หลวงพ่อองค์ดำ", Wheelchair: true},
		{FromKey: "j_south_plaza", ToKey: "bldg_analysis_therapy", Instruction: "เข้าสู่อาคารวิเคราะห์ วิจัย บำบัด", Wheelchair: true},
		{FromKey: "j_south_plaza", ToKey: "bldg_capd_xray", Instruction: "เดินไปฝั่งตะวันตกเข้าสู่อาคารล้างไตทางช่องท้อง / เอ็กซ์เรย์", Wheelchair: true},
		{FromKey: "j_south_plaza", ToKey: "bldg_private_dialysis", Instruction: "เข้าสู่อาคารไตเทียมเอกชน ฝั่งถนนเจริญเมือง", Wheelchair: true},
		{FromKey: "j_south_plaza", ToKey: "j_south_parking", Instruction: "เดินผ่านลานจอดรถฝั่งใต้ไปทางทิศตะวันออก", Wheelchair: true},
		{FromKey: "j_south_parking", ToKey: "bldg_rompho", Instruction: "เข้าสู่อาคารร่มโพธิ์", Wheelchair: true},
		{FromKey: "bldg_rompho", ToKey: "bldg_ortho_jaisawang", Instruction: "เดินต่อไปยังอาคารผู้ป่วยศัลยกรรมกระดูก / ใจสว่าง", Wheelchair: true},
		{FromKey: "bldg_ortho_jaisawang", ToKey: "bldg_prosthetics", Instruction: "เดินต่อไปยังอาคารกายอุปกรณ์", Wheelchair: true},
		{FromKey: "j_south_parking", ToKey: "bldg_physio_thai", Instruction: "เดินขึ้นเหนือจากลานจอดรถใต้สู่อาคารกายภาพบำบัด / แพทย์แผนไทย", Wheelchair: true},
	}

	return initialNodes, initialEdges
}

// SeedInitialBuildings populates Sakon Nakhon Hospital's official buildings, covered walkway junctions,
// and walkable edges ONLY when the `map_nodes` table is completely empty (count == 0).
func SeedInitialBuildings() error {
	if DB == nil {
		return errors.New("database connection is not initialized")
	}

	var count int64
	if err := DB.Model(&models.MapNode{}).Count(&count).Error; err != nil {
		return fmt.Errorf("failed to count map_nodes: %w", err)
	}

	if count > 0 {
		log.Printf("map_nodes already contains %d record(s), skipping initial building seed", count)
		return nil
	}

	return InsertInitialHospitalSeed(DB)
}

// InsertInitialHospitalSeed inserts the official hospital nodes and edges inside a single transaction.
func InsertInitialHospitalSeed(db *gorm.DB) error {
	initialNodes, initialEdges := initialHospitalSeedData()

	err := db.Transaction(func(tx *gorm.DB) error {
		keyToID := make(map[string]uint, len(initialNodes))

		for _, spec := range initialNodes {
			var createdID uint
			if err := tx.Raw(`
				INSERT INTO map_nodes (name, is_building, keywords, indoor_guide, image_url, lat, lng, geom)
				VALUES (?, ?, ?, ?, '', ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326))
				RETURNING id
			`,
				spec.Name,
				spec.IsBuilding,
				spec.Keywords,
				spec.IndoorGuide,
				spec.Lat,
				spec.Lng,
				spec.Lng, // PostGIS ST_MakePoint(longitude, latitude)
				spec.Lat,
			).Scan(&createdID).Error; err != nil {
				return fmt.Errorf("failed to insert seed node %q: %w", spec.Name, err)
			}
			keyToID[spec.Key] = createdID
		}

		for _, edge := range initialEdges {
			fromID, okFrom := keyToID[edge.FromKey]
			toID, okTo := keyToID[edge.ToKey]
			if !okFrom || !okTo {
				continue
			}

			if err := tx.Exec(`
				INSERT INTO map_edges (from_node, to_node, distance_m, instruction, is_wheelchair_friendly, is_active, geom)
				SELECT
					a.id,
					b.id,
					ST_Distance(a.geom::geography, b.geom::geography),
					?,
					?,
					true,
					ST_MakeLine(a.geom, b.geom)
				FROM map_nodes AS a, map_nodes AS b
				WHERE a.id = ? AND b.id = ?
			`, edge.Instruction, edge.Wheelchair, fromID, toID).Error; err != nil {
				return fmt.Errorf("failed to insert seed edge %s -> %s: %w", edge.FromKey, edge.ToKey, err)
			}
		}

		return nil
	})
	if err != nil {
		return err
	}

	log.Printf("Seeded initial Sakon Nakhon Hospital map data (%d nodes, %d edges)", len(initialNodes), len(initialEdges))
	return nil
}

// MigrateAndSeedAdminTables safely adds new columns to map_edges, AutoMigrates the new
// non-PostGIS tables (categories, departments, service_points, announcements) without touching
// existing PostGIS tables, and seeds initial data when each table is empty.
func MigrateAndSeedAdminTables() error {
	if DB == nil {
		return errors.New("database connection is not initialized")
	}

	// 1. Non-destructive column additions on map_nodes, map_edges, and survey_tracks
	alterStatements := []string{
		`ALTER TABLE map_nodes ADD COLUMN IF NOT EXISTS version_id INTEGER`,
		`ALTER TABLE map_nodes ADD COLUMN IF NOT EXISTS building_code VARCHAR(50) NOT NULL DEFAULT ''`,
		`ALTER TABLE map_nodes ADD COLUMN IF NOT EXISTS badge_label VARCHAR(50) NOT NULL DEFAULT ''`,
		`ALTER TABLE map_nodes ADD COLUMN IF NOT EXISTS floor_range VARCHAR(50) NOT NULL DEFAULT ''`,
		`ALTER TABLE map_nodes ADD COLUMN IF NOT EXISTS service_status VARCHAR(40) NOT NULL DEFAULT 'open'`,
		`ALTER TABLE map_nodes ADD COLUMN IF NOT EXISTS category_id INTEGER`,
		`ALTER TABLE map_nodes ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb`,
		`UPDATE map_nodes SET image_urls = jsonb_build_array(image_url) WHERE COALESCE(TRIM(image_url), '') <> '' AND (image_urls IS NULL OR image_urls = '[]'::jsonb)`,
		`ALTER TABLE map_edges ADD COLUMN IF NOT EXISTS version_id INTEGER`,
		`ALTER TABLE map_edges ADD COLUMN IF NOT EXISTS is_covered BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE map_edges ADD COLUMN IF NOT EXISTS is_indoor_passthrough BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE map_edges ADD COLUMN IF NOT EXISTS closure_reason TEXT DEFAULT ''`,
		`ALTER TABLE survey_tracks ADD COLUMN IF NOT EXISTS zone VARCHAR(120) DEFAULT ''`,
		`ALTER TABLE survey_tracks ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'in_progress'`,
		`ALTER TABLE survey_tracks ADD COLUMN IF NOT EXISTS color_hex VARCHAR(20) DEFAULT ''`,
		`CREATE INDEX IF NOT EXISTS idx_map_nodes_version_id ON map_nodes (version_id)`,
		`CREATE INDEX IF NOT EXISTS idx_map_nodes_category_id ON map_nodes (category_id)`,
		`CREATE INDEX IF NOT EXISTS idx_map_edges_version_id ON map_edges (version_id)`,
	}
	for _, stmt := range alterStatements {
		if err := DB.Exec(stmt).Error; err != nil {
			return fmt.Errorf("failed to alter map tables: %w", err)
		}
	}

	// 2. GORM AutoMigrate for new relational tables (never AutoMigrate PostGIS map_nodes/map_edges)
	if err := DB.AutoMigrate(
		&models.AdminSession{},
		&models.MapVersion{},
		&models.Category{},
		&models.Department{},
		&models.ServicePoint{},
		&models.Announcement{},
		&models.AuditLog{},
	); err != nil {
		return fmt.Errorf("failed to auto-migrate admin tables: %w", err)
	}

	// 2.5 Seed default Live Map Version (v1) and bind all existing unversioned nodes/edges to it
	var versionCount int64
	if err := DB.Model(&models.MapVersion{}).Count(&versionCount).Error; err == nil && versionCount == 0 {
		defaultVersion := models.MapVersion{
			Name:        "เวอร์ชันใช้งานจริง (v1)",
			Description: "เวอร์ชันแผนที่เริ่มต้นของโรงพยาบาลสกลนคร (จุด, เส้นเชื่อม และโมเดล 3D ตั้งต้น)",
			IsLive:      true,
		}
		if err := DB.Create(&defaultVersion).Error; err != nil {
			return fmt.Errorf("failed to create default map version: %w", err)
		}
		log.Printf("Created default live map version #%d (%s)", defaultVersion.ID, defaultVersion.Name)
	}

	// Ensure at least one version is marked is_live = true
	var liveVersion models.MapVersion
	if err := DB.Where("is_live = ?", true).Order("id ASC").First(&liveVersion).Error; err != nil {
		if err2 := DB.Order("id ASC").First(&liveVersion).Error; err2 == nil && liveVersion.ID > 0 {
			_ = DB.Model(&models.MapVersion{}).Where("id = ?", liveVersion.ID).Update("is_live", true).Error
			liveVersion.IsLive = true
		}
	}
	if liveVersion.ID > 0 {
		if err := DB.Exec(`UPDATE map_nodes SET version_id = ? WHERE version_id IS NULL OR version_id = 0`, liveVersion.ID).Error; err != nil {
			return fmt.Errorf("failed to backfill map_nodes.version_id: %w", err)
		}
		if err := DB.Exec(`UPDATE map_edges SET version_id = ? WHERE version_id IS NULL OR version_id = 0`, liveVersion.ID).Error; err != nil {
			return fmt.Errorf("failed to backfill map_edges.version_id: %w", err)
		}
		// Copy legacy 3D overrides JSON into versioned file for v1 if present
		legacy3D := "uploads/custom_3d_overrides.json"
		versioned3D := fmt.Sprintf("uploads/custom_3d_overrides_v%d.json", liveVersion.ID)
		if _, err := os.Stat(versioned3D); os.IsNotExist(err) {
			if raw, readErr := os.ReadFile(legacy3D); readErr == nil && len(raw) > 0 {
				_ = os.MkdirAll("uploads", 0o755)
				_ = os.WriteFile(versioned3D, raw, 0o644)
			}
		}
	}

	// 3. Seed Categories if empty
	var catCount int64
	if err := DB.Model(&models.Category{}).Count(&catCount).Error; err == nil && catCount == 0 {
		defaultCategories := []models.Category{
			{Name: "ฉุกเฉิน / OPD", Slug: "er_opd", ColorHex: "#A61B29", BadgeBg: "#FFE4E6", SortOrder: 1, ShowInLegend: true},
			{Name: "ตึก 8 ชั้น / เฉพาะทาง", Slug: "specialty", ColorHex: "#EAB308", BadgeBg: "#FEF9C3", SortOrder: 2, ShowInLegend: true},
			{Name: "ตรวจ / รังสี / กายภาพ", Slug: "diagnostic", ColorHex: "#1F8A70", BadgeBg: "#DBEAFE", SortOrder: 3, ShowInLegend: true},
			{Name: "เด็ก / สูติฯ (ตึกร่มเย็น)", Slug: "maternal_child", ColorHex: "#881337", BadgeBg: "#FCE7F3", SortOrder: 4, ShowInLegend: true},
			{Name: "ศูนย์หัวใจเพื่อแผ่นดิน", Slug: "heart_center", ColorHex: "#4A83B4", BadgeBg: "#DBEAFE", SortOrder: 5, ShowInLegend: true},
			{Name: "อาคารบริการและสนับสนุน", Slug: "support", ColorHex: "#6D4C41", BadgeBg: "#F1F5F9", SortOrder: 6, ShowInLegend: false},
		}
		if err := DB.Create(&defaultCategories).Error; err != nil {
			log.Printf("Warning: failed to seed categories: %v", err)
		} else {
			log.Printf("Seeded %d default categories", len(defaultCategories))
		}
	}

	// Helper to find an existing building node ID by substring match
	findBuildingID := func(keyword string) *uint {
		var node models.MapNode
		if err := DB.Where("is_building = true AND name ILIKE ?", "%"+keyword+"%").Order("id ASC").First(&node).Error; err == nil && node.ID > 0 {
			id := node.ID
			return &id
		}
		return nil
	}

	// 4. Seed Departments if empty (aligned with existing public building guides)
	var deptCount int64
	if err := DB.Model(&models.Department{}).Count(&deptCount).Error; err == nil && deptCount == 0 {
		type deptSeed struct {
			MatchBuilding  string
			Name           string
			Floor          string
			OperatingHours string
			Phone          string
			Keywords       string
		}
		seeds := []deptSeed{
			{"อุบัติเหตุฉุกเฉิน", "ห้องอุบัติเหตุฉุกเฉิน (ER)", "ชั้น 1", "ตลอด 24 ชั่วโมง", "1669 / 042-176-000", "ER, ฉุกเฉิน, อุบัติเหตุ, คัดกรอง"},
			{"อุบัติเหตุฉุกเฉิน", "ห้องตรวจผู้ป่วยนอกทั่วไป (OPD)", "ชั้น 1", "จ.-ศ. 08:30 - 16:30 น.", "042-176-000", "OPD, ผู้ป่วยนอก, ยื่นบัตร, ประกันสังคม"},
			{"อุบัติเหตุฉุกเฉิน", "คลินิกโรคผิวหนัง", "ชั้น 2", "จ.-ศ. 08:30 - 16:30 น.", "042-176-000", "ผิวหนัง, Dermatology"},
			{"อุบัติเหตุฉุกเฉิน", "คลินิกสูติ-นรีเวชกรรม", "ชั้น 3", "จ.-ศ. 08:30 - 16:30 น.", "042-176-000", "สูติ, นรีเวช, ฝากครรภ์"},
			{"อุบัติเหตุฉุกเฉิน", "คลินิกตา และ หู คอ จมูก (ENT)", "ชั้น 4", "จ.-ศ. 08:30 - 16:30 น.", "042-176-000", "ตา, จักษุ, หู คอ จมูก, ENT"},
			{"ร่มเย็น", "หอผู้ป่วยวิกฤตทารกแรกเกิด (NICU 1, 2)", "ชั้น 1", "ตลอด 24 ชั่วโมง", "042-176-000", "NICU, ทารกแรกเกิด"},
			{"ร่มเย็น", "หอผู้ป่วยวิกฤตเด็ก (PICU)", "ชั้น 2", "ตลอด 24 ชั่วโมง", "042-176-000", "PICU, เด็กวิกฤต"},
			{"ร่มเย็น", "หอผู้ป่วยกุมารเวชกรรม 2 และ 3", "ชั้น 4-5", "ตลอด 24 ชั่วโมง", "042-176-000", "กุมารเวชกรรม, หอผู้ป่วยเด็ก"},
			{"ร่มเย็น", "หอผู้ป่วยพิเศษ (Special Ward)", "ชั้น 10", "ตลอด 24 ชั่วโมง", "042-176-000", "ห้องพิเศษ, Special Ward"},
			{"ร่มธรรม", "ห้องยาผู้ป่วยใน", "ชั้น G", "ตลอด 24 ชั่วโมง", "042-176-000", "ห้องยา, จ่ายยาผู้ป่วยใน"},
			{"ร่มธรรม", "หอผู้ป่วยอายุรกรรม / MICU / Stroke", "ชั้น 1-4", "ตลอด 24 ชั่วโมง", "042-176-000", "MICU, Stroke, อายุรกรรม, IPD"},
			{"ร่มธรรม", "หอผู้ป่วยศัลยกรรม และ Trauma", "ชั้น 5-7", "ตลอด 24 ชั่วโมง", "042-176-000", "ศัลยกรรม, Trauma"},
			{"หัวใจเพื่อแผ่นดิน", "จุดชำระเงิน (การเงิน) และจุดรับยาผู้ป่วยนอก", "ชั้น 1", "จ.-ศ. 08:00 - 16:30 น.", "042-176-000", "การเงิน, ชำระเงิน, รับยา ชั้น 1"},
			{"หัวใจเพื่อแผ่นดิน", "ศูนย์โรคหัวใจ คลินิกนอกเวลา (SMC) และฟอกไต", "ชั้น 2-3", "จ.-ศ. 08:30 - 20:00 น.", "042-176-000", "หัวใจ, SMC, คลินิกนอกเวลา, ฟอกไต"},
			{"หัวใจเพื่อแผ่นดิน", "ห้องผ่าตัดหัวใจ (OR) และ CICU", "ชั้น 4", "ตลอด 24 ชั่วโมง", "042-176-000", "CICU, ผ่าตัดหัวใจ, OR"},
			{"รังสีรักษา", "ศูนย์ตรวจ MRI และ CT Scan", "ชั้น 1", "จ.-ศ. 08:30 - 16:30 น.", "042-176-000", "MRI, CT Scan, เอกซเรย์คอมพิวเตอร์"},
			{"รังสีรักษา", "หน่วยรังสีรักษาและเวชศาสตร์นิวเคลียร์", "ชั้น 2-4", "จ.-ศ. 08:30 - 16:30 น.", "042-176-000", "รังสีรักษา, ฉายแสง"},
			{"ศัลยกรรม คลอดผ่าตัด", "ห้องผ่าตัดกลาง (OR) และห้องคลอด", "ชั้น 1-3", "ตลอด 24 ชั่วโมง", "042-176-000", "ผ่าตัด, ห้องคลอด, OR"},
			{"วิเคราะห์ วิจัย บำบัด", "ห้องปฏิบัติการตรวจวิเคราะห์และเจาะเลือด (Lab)", "ชั้น 1-2", "จ.-ศ. 07:00 - 16:30 น.", "042-176-000", "เจาะเลือด, แล็บ, Lab, ตรวจเลือด"},
			{"ล้างไตทางช่องท้อง", "หน่วยล้างไตทางช่องท้อง (CAPD) และเอ็กซ์เรย์", "ชั้น 1-2", "จ.-ศ. 08:30 - 16:30 น.", "042-176-000", "CAPD, ล้างไต, X-Ray"},
			{"กายภาพบำบัด", "คลินิกกายภาพบำบัดและแพทย์แผนไทย", "ชั้น 1-2", "จ.-ศ. 08:30 - 16:30 น.", "042-176-000", "กายภาพบำบัด, แพทย์แผนไทย, เวชศาสตร์ฟื้นฟู"},
		}
		toInsert := make([]models.Department, 0, len(seeds))
		for _, s := range seeds {
			if nodeID := findBuildingID(s.MatchBuilding); nodeID != nil {
				toInsert = append(toInsert, models.Department{
					NodeID:         *nodeID,
					Name:           s.Name,
					Floor:          s.Floor,
					OperatingHours: s.OperatingHours,
					Phone:          s.Phone,
					Keywords:       s.Keywords,
				})
			}
		}
		if len(toInsert) > 0 {
			if err := DB.Create(&toInsert).Error; err != nil {
				log.Printf("Warning: failed to seed departments: %v", err)
			} else {
				log.Printf("Seeded %d default departments", len(toInsert))
			}
		}
	}

	// 5. Seed Service Points if empty (matches existing ServiceDirectory.tsx data)
	var spCount int64
	if err := DB.Model(&models.ServicePoint{}).Count(&spCount).Error; err == nil && spCount == 0 {
		erNodeID := findBuildingID("อุบัติเหตุฉุกเฉิน")
		defaultServices := []models.ServicePoint{
			{
				NodeID:      erNodeID,
				Type:        "emergency",
				Name:        "สายด่วนเจ็บป่วยฉุกเฉิน 1669",
				Description: "ให้บริการตลอด 24 ชั่วโมง สำหรับผู้ป่วยฉุกเฉินวิกฤตและอุบัติเหตุ",
				Phone:       "1669",
				IsActive:    true,
			},
			{
				NodeID:      erNodeID,
				Type:        "info",
				Name:        "ประชาสัมพันธ์ รพ.สกลนคร",
				Description: "สอบถามข้อมูลอาคาร แผนกบริการ สิทธิการรักษา และเยี่ยมผู้ป่วย",
				Phone:       "042-176-000",
				IsActive:    true,
			},
			{
				NodeID:      erNodeID,
				Type:        "opd",
				Name:        "ห้องตรวจผู้ป่วยนอก (OPD)",
				Description: "วันจันทร์ – ศุกร์ เวลา 08:30 – 16:30 น. (ยื่นบัตรตั้งแต่ 06:30 น.)",
				Phone:       "042-176-000",
				IsActive:    true,
			},
			{
				NodeID:      erNodeID,
				Type:        "wheelchair",
				Name:        "จุดบริการรถเข็นและผู้สูงอายุ",
				Description: "สามารถติดต่อขอรับบริการรถเข็นได้ที่จุดคัดกรองหน้าอาคารผู้ป่วยนอกและตึกอุบัติเหตุฉุกเฉิน",
				Phone:       "042-176-000",
				IsActive:    true,
			},
		}
		if err := DB.Create(&defaultServices).Error; err != nil {
			log.Printf("Warning: failed to seed service points: %v", err)
		} else {
			log.Printf("Seeded %d default service points", len(defaultServices))
		}
	}

	// 6. Seed Default Announcement if empty
	var annCount int64
	if err := DB.Model(&models.Announcement{}).Count(&annCount).Error; err == nil && annCount == 0 {
		defaultAnnouncements := []models.Announcement{
			{
				Title:    "ยินดีต้อนรับสู่ระบบนำทางโรงพยาบาลสกลนคร",
				Message:  "ผู้รับบริการสามารถค้นหาชื่อตึกหรือชื่อแผนกเพื่อนำทางเดินเท้าแบบ 3D และใช้ทางเชื่อมมีหลังคาได้ตลอดเส้นทาง",
				Level:    "info",
				IsActive: true,
			},
		}
		if err := DB.Create(&defaultAnnouncements).Error; err != nil {
			log.Printf("Warning: failed to seed announcements: %v", err)
		} else {
			log.Printf("Seeded %d default announcements", len(defaultAnnouncements))
		}
	}

	// 7. Non-destructive backfill for existing buildings (building_code, badge_label, floor_range, service_status, category_id)
	if err := backfillBuildingMetadata(); err != nil {
		log.Printf("Warning: failed to backfill building metadata: %v", err)
	}

	return nil
}

// backfillBuildingMetadata populates default building_code, badge_label, floor_range, service_status,
// and category_id for existing building rows without overwriting any values already set by admins.
func backfillBuildingMetadata() error {
	var cats []models.Category
	if err := DB.Order("sort_order ASC, id ASC").Find(&cats).Error; err != nil {
		return err
	}
	catIDBySlug := make(map[string]uint, len(cats))
	for _, c := range cats {
		catIDBySlug[strings.ToLower(strings.TrimSpace(c.Slug))] = c.ID
	}

	var buildings []models.MapNode
	if err := DB.Where("is_building = true").Order("id ASC").Find(&buildings).Error; err != nil {
		return err
	}

	updatedCount := 0
	for _, b := range buildings {
		nameLower := strings.ToLower(b.Name)
		allText := strings.ToLower(b.Name + " " + b.Keywords + " " + b.IndoorGuide)

		nextCode := strings.TrimSpace(b.BuildingCode)
		nextBadge := strings.TrimSpace(b.BadgeLabel)
		nextFloors := strings.TrimSpace(b.FloorRange)
		nextStatus := strings.TrimSpace(b.ServiceStatus)
		nextCatID := b.CategoryID

		if nextStatus == "" {
			if strings.Contains(nameLower, "ฉุกเฉิน") || strings.Contains(nameLower, "อุบัติเหตุ") || strings.Contains(nameLower, "er") {
				nextStatus = "open_24h"
			} else {
				nextStatus = "open"
			}
		}

		// Match category slug, default badge, code, and floor range
		var matchedSlug string
		switch {
		case strings.Contains(nameLower, "10 ชั้น") || strings.Contains(nameLower, "ร่มเย็น"):
			matchedSlug = "maternal_child"
			if nextCode == "" {
				nextCode = "BLD-10"
			}
			if nextBadge == "" {
				nextBadge = "10 ชั้น"
			}
			if nextFloors == "" {
				nextFloors = "1 - 10"
			}
		case strings.Contains(nameLower, "8 ชั้น") || strings.Contains(nameLower, "ร่มธรรม"):
			matchedSlug = "specialty"
			if nextCode == "" {
				nextCode = "BLD-08"
			}
			if nextBadge == "" {
				nextBadge = "8 ชั้น"
			}
			if nextFloors == "" {
				nextFloors = "G - 7"
			}
		case strings.Contains(nameLower, "หัวใจเพื่อแผ่นดิน"):
			if _, ok := catIDBySlug["heart_center"]; ok {
				matchedSlug = "heart_center"
			} else {
				matchedSlug = "specialty"
			}
			if nextCode == "" {
				nextCode = "BLD-HRT"
			}
			if nextBadge == "" {
				nextBadge = "CICU"
			}
			if nextFloors == "" {
				nextFloors = "1 - 4"
			}
		case strings.Contains(nameLower, "ฉุกเฉิน") || strings.Contains(nameLower, "อุบัติเหตุ"):
			matchedSlug = "er_opd"
			if nextCode == "" {
				nextCode = "BLD-ER"
			}
			if nextBadge == "" {
				nextBadge = "ER / OPD"
			}
			if nextFloors == "" {
				nextFloors = "1 - 9"
			}
		case strings.Contains(nameLower, "รังสีรักษา") || strings.Contains(nameLower, "mri"):
			matchedSlug = "diagnostic"
			if nextCode == "" {
				nextCode = "BLD-MRI"
			}
			if nextBadge == "" {
				nextBadge = "MRI"
			}
			if nextFloors == "" {
				nextFloors = "1 - 4"
			}
		case strings.Contains(nameLower, "วิเคราะห์"):
			matchedSlug = "diagnostic"
			if nextCode == "" {
				nextCode = "BLD-LAB"
			}
			if nextBadge == "" {
				nextBadge = "LAB"
			}
			if nextFloors == "" {
				nextFloors = "1 - 2"
			}
		case strings.Contains(nameLower, "ล้างไต") || strings.Contains(nameLower, "เอ็กซ์เรย์"):
			matchedSlug = "diagnostic"
			if nextBadge == "" {
				nextBadge = "X-Ray"
			}
			if nextFloors == "" {
				nextFloors = "1 - 2"
			}
		case strings.Contains(nameLower, "กายภาพ"):
			matchedSlug = "diagnostic"
			if nextBadge == "" {
				nextBadge = "กายภาพ"
			}
			if nextFloors == "" {
				nextFloors = "1 - 2"
			}
		case strings.Contains(allText, "เด็ก") || strings.Contains(allText, "กุมาร") || strings.Contains(allText, "สูติ") || strings.Contains(allText, "คลอด"):
			matchedSlug = "maternal_child"
			if nextBadge == "" {
				nextBadge = "เด็ก / สูติฯ"
			}
		case strings.Contains(allText, "เภสัช") || strings.Contains(allText, "ร่มโพธิ์") || strings.Contains(allText, "จ่ายกลาง") || strings.Contains(allText, "ร่มฟ้า") || strings.Contains(allText, "ร่มฉัตร"):
			matchedSlug = "support"
			if nextBadge == "" {
				nextBadge = "บริการ"
			}
		default:
			matchedSlug = "specialty"
			if nextBadge == "" {
				nextBadge = "อาคาร"
			}
		}

		if nextCode == "" {
			nextCode = fmt.Sprintf("BLD-%02d", b.ID)
		}
		if nextCatID == nil {
			if cid, ok := catIDBySlug[matchedSlug]; ok {
				cCopy := cid
				nextCatID = &cCopy
			}
		}

		changed := nextCode != b.BuildingCode ||
			nextBadge != b.BadgeLabel ||
			nextFloors != b.FloorRange ||
			nextStatus != b.ServiceStatus ||
			(b.CategoryID == nil && nextCatID != nil)

		if changed {
			if err := DB.Exec(`
				UPDATE map_nodes
				SET building_code = ?,
				    badge_label = ?,
				    floor_range = ?,
				    service_status = ?,
				    category_id = ?
				WHERE id = ?
			`, nextCode, nextBadge, nextFloors, nextStatus, nextCatID, b.ID).Error; err != nil {
				return err
			}
			updatedCount++
		}
	}

	if updatedCount > 0 {
		log.Printf("Backfilled building metadata for %d existing buildings", updatedCount)
	}
	return nil
}
