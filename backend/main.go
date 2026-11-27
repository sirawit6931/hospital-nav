package main

import (
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"hospital-nav-backend/config"
	"hospital-nav-backend/handlers"
	"hospital-nav-backend/middleware"
)

func isAllowedOrigin(origin string) bool {
	if origin == "http://localhost:3000" || origin == "http://127.0.0.1:3000" {
		return true
	}

	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}

	host := strings.ToLower(parsed.Hostname())
	return strings.HasSuffix(host, ".trycloudflare.com")
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && isAllowedOrigin(origin) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func healthCheckHandler(c *gin.Context) {
	if config.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":   "error",
			"database": "not_initialized",
		})
		return
	}

	sqlDB, err := config.DB.DB()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":   "error",
			"database": "disconnected",
			"error":    err.Error(),
		})
		return
	}

	if err := sqlDB.Ping(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":   "error",
			"database": "disconnected",
			"error":    err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   "ok",
		"database": "connected",
	})
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found, falling back to system environment variables")
	}

	if err := config.ConnectDatabase(); err != nil {
		log.Fatalf("Database connection error: %v", err)
	}

	if err := config.SeedDefaultAdmin(); err != nil {
		log.Fatalf("Admin seed error: %v", err)
	}

	if err := config.SeedInitialBuildings(); err != nil {
		log.Fatalf("Initial buildings seed error: %v", err)
	}

	if err := config.MigrateAndSeedAdminTables(); err != nil {
		log.Fatalf("Admin tables migration/seed error: %v", err)
	}

	// Ensure uploads directory exists for serving building photos.
	if err := os.MkdirAll("uploads", 0o755); err != nil {
		log.Fatalf("Failed to create uploads directory: %v", err)
	}

	router := gin.Default()
	router.MaxMultipartMemory = 10 << 20 // 10 MB
	router.Use(corsMiddleware())

	// Static route for uploaded building photos.
	router.Static("/uploads", "./uploads")

	api := router.Group("/api")
	{
		// Public endpoints
		api.GET("/health", healthCheckHandler)
		api.GET("/buildings", handlers.SearchBuildings)
		api.GET("/nodes/:id", handlers.GetPublicNodeByID)
		api.GET("/route", handlers.GetRoute)
		api.GET("/map-3d-overrides", handlers.GetMap3DOverrides)
		api.GET("/categories", handlers.GetPublicCategories)
		api.GET("/service-points", handlers.GetPublicServicePoints)
		api.GET("/announcements", handlers.GetPublicAnnouncements)

		// Public admin authentication & logout
		api.POST("/admin/login", handlers.AdminLogin)
		api.POST("/admin/logout", handlers.AdminLogout)

		// Protected admin endpoints (HttpOnly Cookie session required)
		admin := api.Group("/admin")
		admin.Use(middleware.AdminAuthMiddleware())
		{
			// Current Admin Session (Sliding Expiration)
			admin.GET("/me", handlers.AdminMe)

			// Map Versions (Live / Clone Draft / Switch Live)
			admin.GET("/map-versions", handlers.GetMapVersions)
			admin.POST("/map-versions/:id/clone", handlers.CloneMapVersion)
			admin.PUT("/map-versions/:id", handlers.UpdateMapVersion)
			admin.POST("/map-versions/:id/publish", handlers.PublishMapVersion)
			admin.DELETE("/map-versions/:id", handlers.DeleteMapVersion)

			// Map Nodes
			admin.GET("/nodes", handlers.GetAllNodes)
			admin.POST("/nodes", handlers.CreateNode)
			admin.PUT("/nodes/:id", handlers.UpdateNode)
			admin.DELETE("/nodes/:id", handlers.DeleteNode)

			// Map Edges
			admin.GET("/edges", handlers.GetAllEdges)
			admin.POST("/edges", handlers.CreateEdge)
			admin.PUT("/edges/:id", handlers.UpdateEdge)
			admin.PATCH("/edges/:id", handlers.ToggleEdgeActive)
			admin.DELETE("/edges/:id", handlers.DeleteEdge)

			// Categories CRUD
			admin.GET("/categories", handlers.GetAdminCategories)
			admin.POST("/categories", handlers.CreateCategory)
			admin.PUT("/categories/:id", handlers.UpdateCategory)
			admin.DELETE("/categories/:id", handlers.DeleteCategory)

			// Departments CRUD
			admin.GET("/departments", handlers.GetAdminDepartments)
			admin.POST("/departments", handlers.CreateDepartment)
			admin.PUT("/departments/:id", handlers.UpdateDepartment)
			admin.DELETE("/departments/:id", handlers.DeleteDepartment)

			// Service Points CRUD
			admin.GET("/service-points", handlers.GetAdminServicePoints)
			admin.POST("/service-points", handlers.CreateServicePoint)
			admin.PUT("/service-points/:id", handlers.UpdateServicePoint)
			admin.DELETE("/service-points/:id", handlers.DeleteServicePoint)

			// Announcements CRUD
			admin.GET("/announcements", handlers.GetAdminAnnouncements)
			admin.POST("/announcements", handlers.CreateAnnouncement)
			admin.PUT("/announcements/:id", handlers.UpdateAnnouncement)
			admin.DELETE("/announcements/:id", handlers.DeleteAnnouncement)

			// Survey Tracks (legacy + upgraded /survey-tracks endpoints with append, merge, split)
			admin.GET("/surveys", handlers.GetSurveys)
			admin.POST("/surveys", handlers.CreateSurvey)
			admin.DELETE("/surveys/:id", handlers.DeleteSurvey)

			admin.GET("/survey-tracks", handlers.GetSurveys)
			admin.POST("/survey-tracks", handlers.CreateSurvey)
			admin.PUT("/survey-tracks/:id", handlers.UpdateSurvey)
			admin.PUT("/survey-tracks/:id/append", handlers.AppendSurveyTrack)
			admin.POST("/survey-tracks/merge", handlers.MergeSurveyTracks)
			admin.POST("/survey-tracks/:id/split", handlers.SplitSurveyTrack)
			admin.DELETE("/survey-tracks/:id", handlers.DeleteSurvey)

			// Building Photo Upload
			admin.POST("/upload", handlers.UploadImage)

			// 3D Model Overrides & Custom Extruded Wings
			admin.PUT("/map-3d-overrides", handlers.SaveMap3DOverrides)

			// Full JSON Backup Export
			admin.GET("/export", handlers.ExportAllBackup)

			// Audit Logs & Rollback
			admin.GET("/audit-logs", handlers.GetAuditLogs)
			admin.POST("/audit-logs/:id/rollback", handlers.RollbackAuditLog)
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server listening on http://localhost:%s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
