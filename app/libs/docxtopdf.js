import docxConverter from 'docx-pdf';
import fs from 'fs';
import { promisify } from 'util';

const convertAsync = promisify(docxConverter);

export const convertDocxToPdf = async (inputPath) => {
  try {
    const docxBuf = fs.readFileSync(inputPath);
    const pdfBuf = await convertAsync(docxBuf, 'buffer'); // Convert to buffer
    return pdfBuf;
  } catch (error) {
    console.error('docxToPdf error:', error);
    throw new Error('Failed to convert DOCX to PDF');
  }
};