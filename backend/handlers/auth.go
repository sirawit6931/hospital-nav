package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"hospital-nav-backend/config"
	"hospital-nav-backend/middleware"
	"hospital-nav-backend/models"
)

const (
	sessionSlidingDuration = 60 * time.Minute
	rememberMeDuration     = 7 * 24 * time.Hour
	maxLoginFailures       = 5
	loginLockoutDuration   = 15 * time.Minute
)

type loginAttemptRecord struct {
	failures    int
	firstFailed time.Time
	lockedUntil time.Time
}

var (
	loginRateMu  sync.Mutex
	loginRateMap = make(map[string]*loginAttemptRecord)
)

func checkLoginRateLimit(ip string) (bool, time.Duration) {
	loginRateMu.Lock()
	defer loginRateMu.Unlock()

	now := time.Now()
	rec, exists := loginRateMap[ip]
	if !exists {
		return false, 0
	}
	if !rec.lockedUntil.IsZero() && now.Before(rec.lockedUntil) {
		return true, time.Until(rec.lockedUntil)
	}
	// Reset expired window or expired lock
	if (!rec.lockedUntil.IsZero() && !now.Before(rec.lockedUntil)) || now.Sub(rec.firstFailed) > loginLockoutDuration {
		delete(loginRateMap, ip)
		return false, 0
	}
	return false, 0
}

func recordLoginFailure(ip string) (locked bool) {
	loginRateMu.Lock()
	defer loginRateMu.Unlock()

	now := time.Now()
	rec, exists := loginRateMap[ip]
	if !exists || now.Sub(rec.firstFailed) > loginLockoutDuration {
		rec = &loginAttemptRecord{
			failures:    1,
			firstFailed: now,
		}
		loginRateMap[ip] = rec
		return false
	}

	rec.failures++
	if rec.failures >= maxLoginFailures {
		rec.lockedUntil = now.Add(loginLockoutDuration)
		return true
	}
	return false
}

func clearLoginFailures(ip string) {
	loginRateMu.Lock()
	defer loginRateMu.Unlock()
	delete(loginRateMap, ip)
}

func generateSessionID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func signAdminJWT(secret, sessionID string, adminID uint, username string, rememberMe bool, expiresAt time.Time) (string, error) {
	claims := jwt.MapClaims{
		"sid":         sessionID,
		"admin_id":    adminID,
		"username":    username,
		"remember_me": rememberMe,
		"iat":         time.Now().Unix(),
		"exp":         expiresAt.Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func setAdminSessionCookie(c *gin.Context, signedToken string, rememberMe bool, expiresAt time.Time) {
	cookie := &http.Cookie{
		Name:     middleware.AdminSessionCookieName,
		Value:    signedToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   middleware.IsSecureRequest(c),
		SameSite: http.SameSiteLaxMode,
	}
	// If remember_me is checked -> persistent cookie (7 days).
	// If unchecked -> Session Cookie (MaxAge omitted/0 so browser clears it on close).
	if rememberMe {
		maxAge := int(time.Until(expiresAt).Seconds())
		if maxAge < 60 {
			maxAge = int(sessionSlidingDuration.Seconds())
		}
		cookie.MaxAge = maxAge
		cookie.Expires = expiresAt
	}
	http.SetCookie(c.Writer, cookie)
}

type loginRequest struct {
	Username   string `json:"username" binding:"required"`
	Password   string `json:"password" binding:"required"`
	RememberMe bool   `json:"remember_me"`
}

// AdminLogin authenticates an admin user, creates a server-side session, and sets an HttpOnly cookie.
func AdminLogin(c *gin.Context) {
	clientIP := c.ClientIP()
	if locked, remaining := checkLoginRateLimit(clientIP); locked {
		mins := int(math.Ceil(remaining.Minutes()))
		if mins < 1 {
			mins = 1
		}
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": fmt.Sprintf("กรอกรหัสผ่านผิดเกินกำหนด ระบบล็อกชั่วคราว กรุณาลองใหม่อีกครั้งในอีก %d นาที", mins),
		})
		return
	}

	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "กรุณากรอกชื่อผู้ใช้งานและรหัสผ่านให้ครบถ้วน",
		})
		return
	}

	req.Username = strings.TrimSpace(req.Username)

	var admin models.Admin
	if err := config.DB.Where("username = ?", req.Username).First(&admin).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if recordLoginFailure(clientIP) {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": "กรอกรหัสผ่านผิดเกิน 5 ครั้ง ระบบล็อกชั่วคราว 15 นาที",
				})
				return
			}
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "ไม่สามารถตรวจสอบบัญชีผู้ดูแลระบบได้",
		})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password)); err != nil {
		if recordLoginFailure(clientIP) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "กรอกรหัสผ่านผิดเกิน 5 ครั้ง ระบบล็อกชั่วคราว 15 นาที",
			})
			return
		}
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง",
		})
		return
	}

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "JWT_SECRET is not configured",
		})
		return
	}

	sessionID, err := generateSessionID()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "ไม่สามารถสร้างเซสชันผู้ดูแลระบบได้",
		})
		return
	}

	now := time.Now()
	expiresAt := now.Add(sessionSlidingDuration)

	session := models.AdminSession{
		ID:         sessionID,
		AdminID:    admin.ID,
		RememberMe: false,
		ExpiresAt:  expiresAt,
		Revoked:    false,
	}
	if err := config.DB.Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "ไม่สามารถบันทึกเซสชันผู้ดูแลระบบได้",
		})
		return
	}

	signedToken, err := signAdminJWT(secret, sessionID, admin.ID, admin.Username, false, expiresAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "ไม่สามารถสร้างโทเคนยืนยันตัวตนได้",
		})
		return
	}

	clearLoginFailures(clientIP)
	setAdminSessionCookie(c, signedToken, false, expiresAt)

	c.JSON(http.StatusOK, gin.H{
		"expires_at":  expiresAt.Format(time.RFC3339),
		"remember_me": false,
		"admin": gin.H{
			"id":       admin.ID,
			"username": admin.Username,
		},
	})
}

// AdminMe returns the currently authenticated admin and extends session expiration (Sliding 60 min).
func AdminMe(c *gin.Context) {
	sessionID, _ := c.Get("session_id")
	sid, _ := sessionID.(string)
	adminIDVal, _ := c.Get("admin_id")
	adminID, _ := adminIDVal.(uint)

	var admin models.Admin
	if err := config.DB.First(&admin, adminID).Error; err != nil {
		middleware.ClearAdminCookie(c)
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "ไม่พบบัญชีผู้ดูแลระบบ",
		})
		return
	}

	var session models.AdminSession
	if err := config.DB.Where("id = ? AND revoked = ?", sid, false).First(&session).Error; err != nil {
		middleware.ClearAdminCookie(c)
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "เซสชันหมดอายุแล้ว",
		})
		return
	}

	// Sliding expiration: extend by at least 60 minutes (or keep remaining 7-day window if remember_me)
	now := time.Now()
	nextExpiry := now.Add(sessionSlidingDuration)
	if session.RememberMe && session.ExpiresAt.After(nextExpiry) {
		nextExpiry = session.ExpiresAt
	}

	_ = config.DB.Model(&models.AdminSession{}).
		Where("id = ?", session.ID).
		Updates(map[string]any{
			"expires_at": nextExpiry,
			"updated_at": now,
		}).Error

	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		if refreshedToken, err := signAdminJWT(secret, session.ID, admin.ID, admin.Username, session.RememberMe, nextExpiry); err == nil {
			setAdminSessionCookie(c, refreshedToken, session.RememberMe, nextExpiry)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"expires_at":  nextExpiry.Format(time.RFC3339),
		"remember_me": session.RememberMe,
		"admin": gin.H{
			"id":       admin.ID,
			"username": admin.Username,
		},
	})
}

// AdminLogout revokes the current server-side session and clears the HttpOnly cookie immediately.
func AdminLogout(c *gin.Context) {
	if tokenString, err := c.Cookie(middleware.AdminSessionCookieName); err == nil && strings.TrimSpace(tokenString) != "" {
		if secret := os.Getenv("JWT_SECRET"); secret != "" {
			token, parseErr := jwt.Parse(strings.TrimSpace(tokenString), func(token *jwt.Token) (any, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fmt.Errorf("unexpected signing method")
				}
				return []byte(secret), nil
			})
			if parseErr == nil && token != nil {
				if claims, ok := token.Claims.(jwt.MapClaims); ok {
					if sid, ok := claims["sid"].(string); ok && strings.TrimSpace(sid) != "" {
						_ = config.DB.Model(&models.AdminSession{}).
							Where("id = ?", strings.TrimSpace(sid)).
							Updates(map[string]any{
								"revoked":    true,
								"updated_at": time.Now(),
							}).Error
					}
				}
			}
		}
	}

	middleware.ClearAdminCookie(c)
	c.JSON(http.StatusOK, gin.H{
		"message": "ออกจากระบบเรียบร้อยแล้ว",
	})
}
