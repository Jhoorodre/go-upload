import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Manga Uploader Pro",
  description: "Sistema de upload de mangás com suporte a múltiplos hosts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Estilo para esconder elementos de extensões antes da hidratação
              (function() {
                const style = document.createElement('style');
                style.textContent = '[id*="adr_"], [id*="adblock"], [class*="adr"], [class*="adblock"] { display: none !important; visibility: hidden !important; opacity: 0 !important; }';
                document.head.appendChild(style);
                
                // Remover elementos problemáticos imediatamente
                const removeExtensionElements = function() {
                  const problematicElements = document.querySelectorAll('[id*="adr_"], [id*="adblock"], [class*="adr"], [class*="adblock"]');
                  problematicElements.forEach(function(el) {
                    try {
                      el.remove();
                    } catch(e) {
                      el.style.display = 'none';
                    }
                  });
                };
                
                // Executar imediatamente e novamente após carregamento
                removeExtensionElements();
                document.addEventListener('DOMContentLoaded', removeExtensionElements);
                
                // Observer para elementos inseridos dinamicamente
                const observer = new MutationObserver(function(mutations) {
                  mutations.forEach(function(mutation) {
                    mutation.addedNodes.forEach(function(node) {
                      if (node.nodeType === 1) {
                        const id = node.id || '';
                        const className = typeof node.className === 'string' ? node.className : 
                                         node.className && node.className.toString ? node.className.toString() : '';
                        if (id.includes('adr_') || id.includes('adblock') || 
                            className.includes('adr') || className.includes('adblock')) {
                          try {
                            node.remove();
                          } catch(e) {
                            node.style.display = 'none';
                          }
                        }
                      }
                    });
                  });
                });
                
                if (document.body) {
                  observer.observe(document.body, { childList: true, subtree: true });
                } else {
                  document.addEventListener('DOMContentLoaded', function() {
                    observer.observe(document.body, { childList: true, subtree: true });
                  });
                }
              })();
            `
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="flex h-screen bg-gray-900 font-sans text-sm">
          {children}
        </div>
      </body>
    </html>
  );
}
