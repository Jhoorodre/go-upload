import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    
    // Pegar o caminho configurado dos headers (enviado pelo frontend)
    const metadataPath = request.headers.get('x-metadata-path') || '../json';
    
    // Tentar diferentes variações do nome
    const possibleNames = [
      name,
      name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_'),
      name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-'),
      name.replace(/[^a-zA-Z0-9_-]/g, '_')
    ];

    for (const fileName of possibleNames) {
      try {
        const filePath = join(process.cwd(), metadataPath, `${fileName}.json`);
        const fileContent = readFileSync(filePath, 'utf-8');
        const jsonData = JSON.parse(fileContent);
        
        return NextResponse.json({
          success: true,
          data: jsonData,
          fileName: fileName
        });
      } catch (err) {
        // Continua tentando próximo nome
        continue;
      }
    }

    return NextResponse.json(
      { success: false, error: 'JSON file not found' },
      { status: 404 }
    );
  } catch (error) {
    console.error('Error loading JSON:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
