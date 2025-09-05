package anilist

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// LanguagePreference define as opções de idioma disponíveis
type LanguagePreference string

const (
	LanguageRomaji   LanguagePreference = "romaji"
	LanguageEnglish  LanguagePreference = "english"
	LanguageNative   LanguagePreference = "native"
	LanguageSynonyms LanguagePreference = "synonyms"
)

// FillMode define como os dados são preenchidos
type FillMode string

const (
	FillModeManual FillMode = "manual"     // Mostrar lista para seleção
	FillModeAuto   FillMode = "auto"       // Preenchimento automático do primeiro resultado
)

// AniListConfig contém todas as configurações da integração AniList
type AniListConfig struct {
	// Configurações principais
	Enabled           bool               `json:"enabled"`            // Toggle on/off da integração
	LanguagePreference LanguagePreference `json:"language_preference"` // Idioma preferido
	FillMode          FillMode           `json:"fill_mode"`          // Modo de preenchimento
	
	// Configurações avançadas
	AutoSearch        bool               `json:"auto_search"`        // Busca automática ao digitar
	CacheEnabled      bool               `json:"cache_enabled"`      // Cache local habilitado
	PreferAniList     bool               `json:"prefer_anilist"`     // Preferir dados da AniList sobre manuais
	
	// Metadados
	Version           string             `json:"version"`            // Versão da configuração
	LastUpdated       string             `json:"last_updated"`       // Timestamp da última atualização
}

// GetDefaultConfig retorna as configurações padrão
func GetDefaultConfig() *AniListConfig {
	return &AniListConfig{
		Enabled:            true,
		LanguagePreference: LanguageRomaji,
		FillMode:          FillModeManual,
		AutoSearch:        true,
		CacheEnabled:      true,
		PreferAniList:     false,
		Version:           "1.0",
		LastUpdated:       "",
	}
}

// ConfigManager gerencia as configurações da AniList
type ConfigManager struct {
	config     *AniListConfig
	configPath string
	mutex      sync.RWMutex
}

// NewConfigManager cria um novo gerenciador de configurações
func NewConfigManager(dataDir string) *ConfigManager {
	configPath := filepath.Join(dataDir, "anilist_config.json")
	
	cm := &ConfigManager{
		configPath: configPath,
		config:     GetDefaultConfig(),
	}
	
	// Tentar carregar configurações existentes
	if err := cm.Load(); err != nil {
		// Se não conseguir carregar, usar padrões e salvar
		cm.Save()
	}
	
	return cm
}

// Load carrega as configurações do arquivo
func (cm *ConfigManager) Load() error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
	data, err := os.ReadFile(cm.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Arquivo não existe, usar configurações padrão
			cm.config = GetDefaultConfig()
			return nil
		}
		return fmt.Errorf("erro ao ler arquivo de configuração: %w", err)
	}
	
	var config AniListConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return fmt.Errorf("erro ao decodificar configuração: %w", err)
	}
	
	// Validar configuração carregada
	if err := cm.validateConfig(&config); err != nil {
		// Se configuração inválida, usar padrões
		cm.config = GetDefaultConfig()
		return fmt.Errorf("configuração inválida, usando padrões: %w", err)
	}
	
	cm.config = &config
	return nil
}

// Save salva as configurações no arquivo
func (cm *ConfigManager) Save() error {
	// Não usar mutex aqui - o caller (Update) já tem Lock
	
	// Criar diretório se não existir
	if err := os.MkdirAll(filepath.Dir(cm.configPath), 0755); err != nil {
		return fmt.Errorf("erro ao criar diretório de configuração: %w", err)
	}
	
	// Atualizar timestamp
	cm.config.LastUpdated = fmt.Sprintf("%d", time.Now().Unix())
	
	data, err := json.MarshalIndent(cm.config, "", "  ")
	if err != nil {
		return fmt.Errorf("erro ao codificar configuração: %w", err)
	}
	
	if err := os.WriteFile(cm.configPath, data, 0644); err != nil {
		return fmt.Errorf("erro ao salvar configuração: %w", err)
	}
	
	return nil
}

// Get retorna uma cópia das configurações atuais
func (cm *ConfigManager) Get() *AniListConfig {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	
	// Retornar cópia para evitar modificações concorrentes
	configCopy := *cm.config
	return &configCopy
}

// Update atualiza as configurações
func (cm *ConfigManager) Update(newConfig *AniListConfig) error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
	// Validar nova configuração
	if err := cm.validateConfig(newConfig); err != nil {
		return fmt.Errorf("configuração inválida: %w", err)
	}
	
	// Preservar versão e timestamp são atualizados no Save()
	newConfig.Version = cm.config.Version
	
	cm.config = newConfig
	return cm.Save()
}

// UpdateField atualiza um campo específico
func (cm *ConfigManager) UpdateField(field string, value interface{}) error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
	switch field {
	case "enabled":
		if v, ok := value.(bool); ok {
			cm.config.Enabled = v
		} else {
			return fmt.Errorf("valor inválido para 'enabled': esperado bool")
		}
	case "language_preference":
		if v, ok := value.(string); ok {
			if pref := LanguagePreference(v); cm.isValidLanguage(pref) {
				cm.config.LanguagePreference = pref
			} else {
				return fmt.Errorf("idioma inválido: %s", v)
			}
		} else {
			return fmt.Errorf("valor inválido para 'language_preference': esperado string")
		}
	case "fill_mode":
		if v, ok := value.(string); ok {
			if mode := FillMode(v); cm.isValidFillMode(mode) {
				cm.config.FillMode = mode
			} else {
				return fmt.Errorf("modo de preenchimento inválido: %s", v)
			}
		} else {
			return fmt.Errorf("valor inválido para 'fill_mode': esperado string")
		}
	case "auto_search":
		if v, ok := value.(bool); ok {
			cm.config.AutoSearch = v
		} else {
			return fmt.Errorf("valor inválido para 'auto_search': esperado bool")
		}
	case "cache_enabled":
		if v, ok := value.(bool); ok {
			cm.config.CacheEnabled = v
		} else {
			return fmt.Errorf("valor inválido para 'cache_enabled': esperado bool")
		}
	case "prefer_anilist":
		if v, ok := value.(bool); ok {
			cm.config.PreferAniList = v
		} else {
			return fmt.Errorf("valor inválido para 'prefer_anilist': esperado bool")
		}
	default:
		return fmt.Errorf("campo desconhecido: %s", field)
	}
	
	return cm.Save()
}

// validateConfig valida se a configuração é válida
func (cm *ConfigManager) validateConfig(config *AniListConfig) error {
	if !cm.isValidLanguage(config.LanguagePreference) {
		return fmt.Errorf("idioma inválido: %s", config.LanguagePreference)
	}
	
	if !cm.isValidFillMode(config.FillMode) {
		return fmt.Errorf("modo de preenchimento inválido: %s", config.FillMode)
	}
	
	return nil
}

// isValidLanguage verifica se o idioma é válido
func (cm *ConfigManager) isValidLanguage(lang LanguagePreference) bool {
	return lang == LanguageRomaji || lang == LanguageEnglish || lang == LanguageNative || lang == LanguageSynonyms
}

// isValidFillMode verifica se o modo de preenchimento é válido
func (cm *ConfigManager) isValidFillMode(mode FillMode) bool {
	return mode == FillModeManual || mode == FillModeAuto
}

// IsEnabled retorna se a integração AniList está habilitada
func (cm *ConfigManager) IsEnabled() bool {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	return cm.config.Enabled
}

// GetLanguagePreference retorna o idioma preferido
func (cm *ConfigManager) GetLanguagePreference() LanguagePreference {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	return cm.config.LanguagePreference
}

// GetFillMode retorna o modo de preenchimento
func (cm *ConfigManager) GetFillMode() FillMode {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	return cm.config.FillMode
}

// IsAutoSearchEnabled retorna se a busca automática está habilitada
func (cm *ConfigManager) IsAutoSearchEnabled() bool {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	return cm.config.AutoSearch
}

// IsCacheEnabled retorna se o cache está habilitado
func (cm *ConfigManager) IsCacheEnabled() bool {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	return cm.config.CacheEnabled
}

// ShouldPreferAniList retorna se deve preferir dados da AniList
func (cm *ConfigManager) ShouldPreferAniList() bool {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	return cm.config.PreferAniList
}

// GetConfigPath retorna o caminho do arquivo de configuração
func (cm *ConfigManager) GetConfigPath() string {
	return cm.configPath
}

// Reset restaura as configurações padrão
func (cm *ConfigManager) Reset() error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
	cm.config = GetDefaultConfig()
	return cm.Save()
}

// GetStats retorna estatísticas das configurações
func (cm *ConfigManager) GetStats() map[string]interface{} {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	
	return map[string]interface{}{
		"config_version":     cm.config.Version,
		"last_updated":       cm.config.LastUpdated,
		"integration_enabled": cm.config.Enabled,
		"language":           string(cm.config.LanguagePreference),
		"fill_mode":          string(cm.config.FillMode),
		"auto_search":        cm.config.AutoSearch,
		"cache_enabled":      cm.config.CacheEnabled,
		"prefer_anilist":     cm.config.PreferAniList,
		"config_file":        cm.configPath,
	}
}
