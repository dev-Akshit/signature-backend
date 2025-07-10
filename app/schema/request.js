import Zod from 'zod';

export const requestSchema = Zod.object({
  id: Zod.string(),
  title: Zod.string(),
  documentCount: Zod.number(),
  rejectedCount: Zod.number(),
  createdAt: Zod.string(),
  status: Zod.number(),
  description: Zod.string().optional(),
  url: Zod.string().optional(),
  rejectionReason: Zod.string().optional(),
  documents: Zod.array(
    Zod.object({
      id: Zod.string(),
      name: Zod.string(),
      filePath: Zod.string(),
      uploadedAt: Zod.string(),
      signedDate: Zod.string().optional(),
      signStatus: Zod.number(),
      data: Zod.record(Zod.string(), Zod.any()),
      rejectionReason: Zod.string().optional(),
    })
  ),
});

export const RequestCreationSchema = Zod.object({
  title: Zod.string().min(1),
  description: Zod.string().optional(),
  templateFile: Zod.any(),
  templateVariables: Zod.array(
    Zod.object({
      name: Zod.string(),
      required: Zod.boolean(),
      showOnExcel: Zod.boolean(),
    })
  ).optional(),
});

export const DocumentUploadSchema = Zod.object({
  documents: Zod.any(),
  dataEntries: Zod.array(
    Zod.object({
      id: Zod.string().optional(),
      url: Zod.string().optional(),
      data: Zod.record(Zod.string(), Zod.any()),
      signStatus: Zod.number().optional(),
      createdAt: Zod.string().optional(),
    })
  ).optional(),
});

export const SendForSignatureSchema = Zod.object({
  officerId: Zod.string(),
});
