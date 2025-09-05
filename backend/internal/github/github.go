package github

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

// GitHubService provides GitHub API integration
type GitHubService struct {
	baseURL    string
	httpClient *http.Client
}

// NewGitHubService creates a new GitHub service instance
func NewGitHubService() *GitHubService {
	return &GitHubService{
		baseURL: "https://api.github.com",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// FolderInfo represents a folder in the repository
type FolderInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
}

// CommitResponse represents the response from GitHub commit API
type CommitResponse struct {
	SHA     string `json:"sha"`
	Message string `json:"message"`
	URL     string `json:"html_url"`
}

// ListFolders lists all folders in the root of a repository
func (g *GitHubService) ListFolders(token, repo, branch string) ([]FolderInfo, error) {
	return g.listFoldersRecursively(token, repo, branch, "", 2) // Max depth 2 for performance
}

// ListFoldersRecursively lists all folders recursively up to a specified depth
func (g *GitHubService) ListFoldersRecursively(token, repo, branch string, maxDepth int) ([]FolderInfo, error) {
	return g.listFoldersRecursively(token, repo, branch, "", maxDepth)
}

// listFoldersRecursively is the internal recursive function
func (g *GitHubService) listFoldersRecursively(token, repo, branch, path string, maxDepth int) ([]FolderInfo, error) {
	if token == "" || repo == "" {
		return nil, fmt.Errorf("token and repo are required")
	}

	if maxDepth <= 0 {
		return []FolderInfo{}, nil
	}

	if branch == "" {
		branch = "main"
	}

	// Build URL with path if provided
	url := fmt.Sprintf("%s/repos/%s/contents", g.baseURL, repo)
	if path != "" {
		url = fmt.Sprintf("%s/%s", url, path)
	}
	url = fmt.Sprintf("%s?ref=%s", url, branch)
	
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "Manga-Uploader/1.0")

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	var contents []struct {
		Name string `json:"name"`
		Path string `json:"path"`
		Type string `json:"type"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&contents); err != nil {
		return nil, fmt.Errorf("failed to decode response: %v", err)
	}

	var allFolders []FolderInfo
	
	// Add current level folders
	for _, item := range contents {
		if item.Type == "dir" {
			allFolders = append(allFolders, FolderInfo{
				Name: item.Name,
				Path: item.Path,
				Type: item.Type,
			})
			
			// Recursively get subfolders if we haven't reached max depth
			if maxDepth > 1 {
				subFolders, err := g.listFoldersRecursively(token, repo, branch, item.Path, maxDepth-1)
				if err != nil {
					// Log error but continue with other folders
					fmt.Printf("Warning: failed to get subfolders for %s: %v\n", item.Path, err)
					continue
				}
				allFolders = append(allFolders, subFolders...)
			}
		}
	}

	return allFolders, nil
}

// UploadJSONFiles uploads multiple JSON files to GitHub repository
func (g *GitHubService) UploadJSONFiles(token, repo, branch, folder string, jsonFiles map[string]string) (*CommitResponse, error) {
	if token == "" || repo == "" {
		return nil, fmt.Errorf("token and repo are required")
	}

	if branch == "" {
		branch = "main"
	}

	// Prepare commit data
	commitData := struct {
		Message string `json:"message"`
		Branch  string `json:"branch"`
		Files   []struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		} `json:"files"`
	}{
		Message: fmt.Sprintf("Upload %d JSON metadata files via Manga-Uploader", len(jsonFiles)),
		Branch:  branch,
	}

	// Add files to commit
	for filename, content := range jsonFiles {
		filePath := filename
		if folder != "" {
			filePath = filepath.Join(folder, filename)
		}
		// Use forward slashes for GitHub paths
		filePath = strings.ReplaceAll(filePath, "\\", "/")

		commitData.Files = append(commitData.Files, struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}{
			Path:    filePath,
			Content: content,
		})
	}

	// For now, we'll use the contents API to upload files one by one
	// GitHub doesn't have a bulk upload API, so we need to commit each file
	var lastCommitSHA string
	uploadedCount := 0

	for filename, content := range jsonFiles {
		filePath := filename
		if folder != "" {
			filePath = filepath.Join(folder, filename)
		}
		// Use forward slashes for GitHub paths
		filePath = strings.ReplaceAll(filePath, "\\", "/")

		commitSHA, err := g.uploadSingleFile(token, repo, branch, filePath, content, fmt.Sprintf("Update %s via Manga-Uploader", filename))
		if err != nil {
			return nil, fmt.Errorf("failed to upload %s: %v", filename, err)
		}

		lastCommitSHA = commitSHA
		uploadedCount++
	}

	// Return summary response
	return &CommitResponse{
		SHA:     lastCommitSHA,
		Message: fmt.Sprintf("Successfully uploaded %d JSON files", uploadedCount),
		URL:     fmt.Sprintf("https://github.com/%s/commits/%s", repo, lastCommitSHA),
	}, nil
}

// uploadSingleFile uploads a single file to GitHub
func (g *GitHubService) uploadSingleFile(token, repo, branch, filePath, content, message string) (string, error) {
	url := fmt.Sprintf("%s/repos/%s/contents/%s", g.baseURL, repo, filePath)

	// Check if file exists to get SHA for update
	var existingSHA string
	if sha, err := g.getFileSHA(token, repo, branch, filePath); err == nil {
		existingSHA = sha
	}

	// Encode content to base64 as required by GitHub API
	encodedContent := base64.StdEncoding.EncodeToString([]byte(content))
	
	requestData := map[string]string{
		"message": message,
		"content": encodedContent, // Content must be base64 encoded for GitHub API
		"branch":  branch,
	}

	if existingSHA != "" {
		requestData["sha"] = existingSHA
	}

	jsonData, err := json.Marshal(requestData)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request data: %v", err)
	}

	req, err := http.NewRequest("PUT", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "Manga-Uploader/1.0")

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to make request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	var response struct {
		Commit struct {
			SHA string `json:"sha"`
		} `json:"commit"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return "", fmt.Errorf("failed to decode response: %v", err)
	}

	return response.Commit.SHA, nil
}

// getFileSHA gets the SHA of an existing file
func (g *GitHubService) getFileSHA(token, repo, branch, filePath string) (string, error) {
	url := fmt.Sprintf("%s/repos/%s/contents/%s?ref=%s", g.baseURL, repo, filePath, branch)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "Manga-Uploader/1.0")

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", fmt.Errorf("file not found")
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	var response struct {
		SHA string `json:"sha"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return "", err
	}

	return response.SHA, nil
}

// ValidateToken validates a GitHub token by making a simple API call
func (g *GitHubService) ValidateToken(token string) error {
	if token == "" {
		return fmt.Errorf("token is required")
	}

	url := fmt.Sprintf("%s/user", g.baseURL)
	
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "Manga-Uploader/1.0")

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to make request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("invalid or expired token")
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	return nil
}

// ValidateRepository checks if a repository exists and is accessible
func (g *GitHubService) ValidateRepository(token, repo string) error {
	if token == "" || repo == "" {
		return fmt.Errorf("token and repo are required")
	}

	url := fmt.Sprintf("%s/repos/%s", g.baseURL, repo)
	
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "Manga-Uploader/1.0")

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to make request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("repository not found or not accessible")
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	return nil
}