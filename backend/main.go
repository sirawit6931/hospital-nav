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
		api.GET("/route", handlers.GetRoute)

		// Public admin authentication
		api.POST("/admin/login", handlers.AdminLogin)

		// Protected admin endpoints (JWT Bearer required)
		admin := api.Group("/admin")
		admin.Use(middleware.AdminAuthMiddleware())
		{
			// Map Nodes
			admin.GET("/nodes", handlers.GetAllNodes)
			admin.POST("/nodes", handlers.CreateNode)
			admin.PUT("/nodes/:id", handlers.UpdateNode)
			admin.DELETE("/nodes/:id", handlers.DeleteNode)

			// Map Edges
			admin.GET("/edges", handlers.GetAllEdges)
			admin.POST("/edges", handlers.CreateEdge)
			admin.PATCH("/edges/:id", handlers.ToggleEdgeActive)
			admin.DELETE("/edges/:id", handlers.DeleteEdge)

			// Survey Tracks
			admin.GET("/surveys", handlers.GetSurveys)
			admin.POST("/surveys", handlers.CreateSurvey)
			admin.DELETE("/surveys/:id", handlers.DeleteSurvey)

			// Building Photo Upload
			admin.POST("/upload", handlers.UploadImage)
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
