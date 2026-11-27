package middleware

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

const AdminSessionCookieName = "admin_session"

// IsSecureRequest detects whether the client connected over HTTPS (directly or via reverse proxy / Cloudflare Tunnel).
func IsSecureRequest(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https") {
		return true
	}
	origin := strings.ToLower(strings.TrimSpace(c.GetHeader("Origin")))
	return strings.HasPrefix(origin, "https://")
}

// ClearAdminCookie expires the admin_session cookie immediately.
func ClearAdminCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     AdminSessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   IsSecureRequest(c),
		SameSite: http.SameSiteLaxMode,
	})
}

// AdminAuthMiddleware validates the JWT stored in the HttpOnly `admin_session` cookie
// and checks server-side session revocation in the `admin_sessions` table.
func AdminAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString, err := c.Cookie(AdminSessionCookieName)
		tokenString = strings.TrimSpace(tokenString)
		if err != nil || tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "กรุณาเข้าสู่ระบบผู้ดูแลก่อนใช้งาน",
			})
			return
		}

		secret := os.Getenv("JWT_SECRET")
		if secret == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "JWT secret is not configured",
			})
			return
		}

		token, parseErr := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(secret), nil
		})
		if parseErr != nil || !token.Valid {
			ClearAdminCookie(c)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่",
			})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			ClearAdminCookie(c)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "ข้อมูลยืนยันตัวตนไม่ถูกต้อง",
			})
			return
		}

		sid, _ := claims["sid"].(string)
		sid = strings.TrimSpace(sid)
		if sid == "" {
			ClearAdminCookie(c)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่",
			})
			return
		}

		var session models.AdminSession
		if err := config.DB.Where("id = ?", sid).First(&session).Error; err != nil || session.Revoked || time.Now().After(session.ExpiresAt) {
			ClearAdminCookie(c)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "เซสชันถูกยกเลิกหรือหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่",
			})
			return
		}

		c.Set("session_id", session.ID)
		c.Set("remember_me", session.RememberMe)
		c.Set("admin_id", session.AdminID)
		if username, exists := claims["username"]; exists {
			c.Set("username", username)
		}

		c.Next()
	}
}
