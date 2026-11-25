package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	uploadDir         = "uploads"
	maxUploadFileSize = 10 << 20 // 10 MB
)

var allowedImageExtensions = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".webp": true,
	".gif":  true,
}

var allowedImageContentTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
	"image/gif":  true,
}

func randomHexSuffix(numBytes int) (string, error) {
	buf := make([]byte, numBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// UploadImage receives a building photo, stores it in backend/uploads, and returns its accessible URL.
func UploadImage(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		// Fallback to form field "image" for flexibility with clients.
		fileHeader, err = c.FormFile("image")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Image file is required (use form field 'file' or 'image')",
			})
			return
		}
	}

	if fileHeader.Size <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Uploaded file is empty",
		})
		return
	}
	if fileHeader.Size > maxUploadFileSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"error": "File size exceeds maximum limit of 10MB",
		})
		return
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if !allowedImageExtensions[ext] {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Unsupported file extension (allowed: .jpg, .jpeg, .png, .webp, .gif)",
		})
		return
	}

	src, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to read uploaded file",
		})
		return
	}
	defer src.Close()

	// Inspect the first 512 bytes to verify actual image content type.
	headerBuf := make([]byte, 512)
	n, readErr := src.Read(headerBuf)
	if readErr != nil && readErr != io.EOF {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to inspect uploaded file",
		})
		return
	}
	detectedType := http.DetectContentType(headerBuf[:n])
	if !allowedImageContentTypes[detectedType] {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Uploaded file is not a valid image",
		})
		return
	}

	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to prepare uploads directory",
		})
		return
	}

	suffix, err := randomHexSuffix(6)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to generate unique filename",
		})
		return
	}

	filename := fmt.Sprintf("%d_%s%s", time.Now().UnixNano(), suffix, ext)
	dstPath := filepath.Join(uploadDir, filename)

	dst, err := os.Create(dstPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create destination file",
		})
		return
	}
	defer dst.Close()

	if _, err := dst.Write(headerBuf[:n]); err != nil {
		_ = os.Remove(dstPath)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to save uploaded file",
		})
		return
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = os.Remove(dstPath)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to save uploaded file",
		})
		return
	}

	imageURL := "/uploads/" + filename
	c.JSON(http.StatusCreated, gin.H{
		"url":       imageURL,
		"image_url": imageURL,
		"filename":  filename,
	})
}
