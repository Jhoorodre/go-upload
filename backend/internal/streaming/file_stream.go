package streaming

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

// ChunkSize define o tamanho dos chunks para streaming (512KB)
const ChunkSize = 512 * 1024

// FileStreamer gerencia streaming de arquivos grandes
type FileStreamer struct {
	maxConcurrentStreams int
	activeStreams        map[string]*streamState
	mu                   sync.RWMutex
	ctx                  context.Context
	cancel               context.CancelFunc
	wg                   sync.WaitGroup
}

// streamState mantém o estado de um stream ativo
type streamState struct {
	filePath     string
	reader       io.ReadCloser
	totalSize    int64
	bytesRead    int64
	chunkIndex   int
	isCompleted  bool
	mu           sync.RWMutex
	ctx          context.Context
	cancel       context.CancelFunc
}

// StreamChunk representa um chunk de dados
type StreamChunk struct {
	StreamID   string `json:"streamId"`
	ChunkIndex int    `json:"chunkIndex"`
	Data       []byte `json:"data"`
	Size       int    `json:"size"`
	IsLast     bool   `json:"isLast"`
	Error      string `json:"error,omitempty"`
}

// StreamProgress representa o progresso de um stream
type StreamProgress struct {
	StreamID    string  `json:"streamId"`
	BytesRead   int64   `json:"bytesRead"`
	TotalSize   int64   `json:"totalSize"`
	Percentage  float64 `json:"percentage"`
	ChunkIndex  int     `json:"chunkIndex"`
	IsCompleted bool    `json:"isCompleted"`
}

// NewFileStreamer cria um novo gerenciador de streams
func NewFileStreamer(maxConcurrentStreams int) *FileStreamer {
	if maxConcurrentStreams <= 0 {
		maxConcurrentStreams = 10
	}
	
	ctx, cancel := context.WithCancel(context.Background())
	
	return &FileStreamer{
		maxConcurrentStreams: maxConcurrentStreams,
		activeStreams:        make(map[string]*streamState),
		ctx:                  ctx,
		cancel:               cancel,
	}
}

// StartStream inicia um novo stream para um arquivo
func (fs *FileStreamer) StartStream(streamID, filePath string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	
	// Verificar se já existe um stream com este ID
	if _, exists := fs.activeStreams[streamID]; exists {
		return fmt.Errorf("stream already exists: %s", streamID)
	}
	
	// Verificar limite de streams concorrentes
	if len(fs.activeStreams) >= fs.maxConcurrentStreams {
		return fmt.Errorf("maximum concurrent streams reached: %d", fs.maxConcurrentStreams)
	}
	
	// Verificar se o arquivo existe
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("failed to stat file: %v", err)
	}
	
	// Abrir arquivo para leitura
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %v", err)
	}
	
	ctx, cancel := context.WithCancel(fs.ctx)
	
	stream := &streamState{
		filePath:  filePath,
		reader:    file,
		totalSize: fileInfo.Size(),
		ctx:       ctx,
		cancel:    cancel,
	}
	
	fs.activeStreams[streamID] = stream
	return nil
}

// ReadChunk lê o próximo chunk de dados do stream
func (fs *FileStreamer) ReadChunk(streamID string) (*StreamChunk, error) {
	fs.mu.RLock()
	stream, exists := fs.activeStreams[streamID]
	fs.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("stream not found: %s", streamID)
	}
	
	stream.mu.Lock()
	defer stream.mu.Unlock()
	
	if stream.isCompleted {
		return nil, fmt.Errorf("stream already completed: %s", streamID)
	}
	
	// Buffer para ler chunk
	buffer := make([]byte, ChunkSize)
	n, err := stream.reader.Read(buffer)
	
	if err != nil && err != io.EOF {
		return &StreamChunk{
			StreamID: streamID,
			Error:    err.Error(),
		}, err
	}
	
	isLast := err == io.EOF || n < ChunkSize
	
	// Atualizar estado
	stream.bytesRead += int64(n)
	stream.chunkIndex++
	
	chunk := &StreamChunk{
		StreamID:   streamID,
		ChunkIndex: stream.chunkIndex,
		Data:       buffer[:n],
		Size:       n,
		IsLast:     isLast,
	}
	
	if isLast {
		stream.isCompleted = true
		stream.reader.Close()
	}
	
	return chunk, nil
}

// GetProgress retorna o progresso atual do stream
func (fs *FileStreamer) GetProgress(streamID string) (*StreamProgress, error) {
	fs.mu.RLock()
	stream, exists := fs.activeStreams[streamID]
	fs.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("stream not found: %s", streamID)
	}
	
	stream.mu.RLock()
	defer stream.mu.RUnlock()
	
	percentage := float64(0)
	if stream.totalSize > 0 {
		percentage = float64(stream.bytesRead) / float64(stream.totalSize) * 100
	}
	
	return &StreamProgress{
		StreamID:    streamID,
		BytesRead:   stream.bytesRead,
		TotalSize:   stream.totalSize,
		Percentage:  percentage,
		ChunkIndex:  stream.chunkIndex,
		IsCompleted: stream.isCompleted,
	}, nil
}

// CloseStream fecha e remove um stream
func (fs *FileStreamer) CloseStream(streamID string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	
	stream, exists := fs.activeStreams[streamID]
	if !exists {
		return fmt.Errorf("stream not found: %s", streamID)
	}
	
	stream.cancel()
	stream.reader.Close()
	delete(fs.activeStreams, streamID)
	
	return nil
}

// GetActiveStreams retorna a lista de streams ativos
func (fs *FileStreamer) GetActiveStreams() []string {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	
	streams := make([]string, 0, len(fs.activeStreams))
	for streamID := range fs.activeStreams {
		streams = append(streams, streamID)
	}
	
	return streams
}

// Close fecha todos os streams e o gerenciador
func (fs *FileStreamer) Close() {
	fs.cancel()
	
	fs.mu.Lock()
	for _, stream := range fs.activeStreams {
		stream.cancel()
		stream.reader.Close()
	}
	fs.activeStreams = make(map[string]*streamState)
	fs.mu.Unlock()
	
	fs.wg.Wait()
}

// Base64StreamDecoder decodifica chunks base64 de forma streaming
type Base64StreamDecoder struct {
	decoder    *base64.Decoder
	buffer     []byte
	remaining  []byte
	outputFile *os.File
	mu         sync.Mutex
}

// NewBase64StreamDecoder cria um novo decodificador base64 streaming
func NewBase64StreamDecoder(outputPath string) (*Base64StreamDecoder, error) {
	// Criar diretório se não existir
	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %v", err)
	}
	
	outputFile, err := os.Create(outputPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create output file: %v", err)
	}
	
	return &Base64StreamDecoder{
		outputFile: outputFile,
		buffer:     make([]byte, 4096),
	}, nil
}

// WriteChunk processa um chunk de dados base64
func (bsd *Base64StreamDecoder) WriteChunk(base64Data []byte) error {
	bsd.mu.Lock()
	defer bsd.mu.Unlock()
	
	// Combinar dados restantes do chunk anterior com novos dados
	combined := append(bsd.remaining, base64Data...)
	
	// Criar reader para dados base64
	reader := bufio.NewReader(io.BytesReader(combined))
	decoder := base64.NewDecoder(base64.StdEncoding, reader)
	
	// Decodificar e escrever no arquivo
	for {
		n, err := decoder.Read(bsd.buffer)
		if n > 0 {
			if _, writeErr := bsd.outputFile.Write(bsd.buffer[:n]); writeErr != nil {
				return fmt.Errorf("failed to write to output file: %v", writeErr)
			}
		}
		
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to decode base64: %v", err)
		}
	}
	
	// Calcular quantos bytes foram usados
	usedBytes := len(combined)
	
	// Base64 deve ser múltiplo de 4, manter resto para próximo chunk
	remainder := usedBytes % 4
	if remainder > 0 {
		bsd.remaining = combined[usedBytes-remainder:]
	} else {
		bsd.remaining = nil
	}
	
	return nil
}

// Close finaliza a decodificação e fecha o arquivo
func (bsd *Base64StreamDecoder) Close() error {
	bsd.mu.Lock()
	defer bsd.mu.Unlock()
	
	// Processar dados restantes se houver
	if len(bsd.remaining) > 0 {
		decoder := base64.NewDecoder(base64.StdEncoding, io.BytesReader(bsd.remaining))
		for {
			n, err := decoder.Read(bsd.buffer)
			if n > 0 {
				if _, writeErr := bsd.outputFile.Write(bsd.buffer[:n]); writeErr != nil {
					return fmt.Errorf("failed to write final data: %v", writeErr)
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				return fmt.Errorf("failed to decode final base64: %v", err)
			}
		}
	}
	
	return bsd.outputFile.Close()
}

// GetOutputPath retorna o caminho do arquivo de saída
func (bsd *Base64StreamDecoder) GetOutputPath() string {
	return bsd.outputFile.Name()
}

// StreamToTempFile converte dados base64 streaming para arquivo temporário
func StreamToTempFile(base64Chunks <-chan []byte) (string, error) {
	// Criar arquivo temporário
	tmpFile, err := os.CreateTemp("", "stream-decode-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %v", err)
	}
	defer tmpFile.Close()
	
	decoder, err := NewBase64StreamDecoder(tmpFile.Name())
	if err != nil {
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("failed to create decoder: %v", err)
	}
	defer decoder.Close()
	
	// Processar chunks
	for chunk := range base64Chunks {
		if err := decoder.WriteChunk(chunk); err != nil {
			os.Remove(tmpFile.Name())
			return "", fmt.Errorf("failed to process chunk: %v", err)
		}
	}
	
	return tmpFile.Name(), nil
}

// io.BytesReader cria um reader a partir de bytes
func io.BytesReader(data []byte) io.Reader {
	return &bytesReader{data: data}
}

type bytesReader struct {
	data []byte
	pos  int
}

func (br *bytesReader) Read(p []byte) (n int, err error) {
	if br.pos >= len(br.data) {
		return 0, io.EOF
	}
	
	n = copy(p, br.data[br.pos:])
	br.pos += n
	
	return n, nil
}