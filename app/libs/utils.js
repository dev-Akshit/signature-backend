import fs from 'fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { promisify } from 'util';
import libre from 'libreoffice-convert';

export const convertAsync = promisify(libre.convert);

export const extractTemplateVariables = async (templateFile) => {
  const content = fs.readFileSync(templateFile, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });
  const text = doc.getFullText();
  const placeholderRegex = /\{([^{}]+)}/g;
  const specialFields = ['Court', '%Signature', '%qrCode'];
  const variables = new Set();

  let match;
  while ((match = placeholderRegex.exec(text)) !== null) {
    const variable = match[1].trim();
    if (!variables.has(variable)) {
      variables.add(variable);
    }
  }

  return Array.from(variables).map((name) => ({
    name,
    required: !specialFields.includes(name),
    showOnExcel: !specialFields.includes(name),
  }));
};

export const generateMongooseDuplicateKeyMessage = (mongooseError) => {
    let message = Object.entries(mongooseError?.keyValue ?? {}).reduce((result, [key, value]) => {
        result += `Key: ${key} for value: ${JSON.stringify(value)} `
        return result;
    }, '');
    return `Error: Duplicate entries ${message}`;
}



let io = null;

export const setIO = (ioInstance) => {
  io = ioInstance;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized");
  }
  return io;
};