package config

import (
	"errors"
	"fmt"
	"log"
	"os"
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
