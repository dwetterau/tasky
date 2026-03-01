import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { insertEvent } from "./events";
import { apiKeyType } from "./schema";

const ENCRYPTION_KEY_VERSION = 1;
const AES_GCM_IV_BYTES = 12;

function getEncryptionSecret(): string {
  const secret = process.env.API_KEYS_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("Missing API_KEYS_ENCRYPTION_SECRET");
  }
  return secret;
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0) {
    throw new Error("Invalid encrypted payload");
  }
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function encryptApiKey(plaintext: string): Promise<{ encryptedValue: string; iv: string }> {
  const secret = getEncryptionSecret();
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    encryptedValue: bytesToHex(new Uint8Array(encrypted)),
    iv: bytesToHex(iv),
  };
}

// Helper kept for future provider integrations that need to use stored keys.
export async function decryptApiKey(encryptedValue: string, ivHex: string): Promise<string> {
  const secret = getEncryptionSecret();
  const key = await deriveAesKey(secret);
  const ivBytes = hexToBytes(ivHex);
  const encryptedBytes = hexToBytes(encryptedValue);
  const iv = new Uint8Array(ivBytes.length);
  iv.set(ivBytes);
  const encrypted = new Uint8Array(encryptedBytes.length);
  encrypted.set(encryptedBytes);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const rows = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    return rows.map((row) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      userId: row.userId,
      name: row.name,
      type: row.type,
      keyVersion: row.keyVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    type: apiKeyType,
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const name = args.name.trim();
    const value = args.value.trim();
    if (!name) {
      throw new Error("API key name is required");
    }
    if (!value) {
      throw new Error("API key value is required");
    }

    const encrypted = await encryptApiKey(value);
    const now = Date.now();
    const apiKeyId = await ctx.db.insert("apiKeys", {
      userId,
      name,
      type: args.type,
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      keyVersion: ENCRYPTION_KEY_VERSION,
      createdAt: now,
      updatedAt: now,
    });

    await insertEvent(ctx, {
      userId,
      entityId: apiKeyId,
      action: { type: "api_key.created" },
    });

    return apiKeyId;
  },
});

export const remove = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== userId) {
      throw new Error("API key not found or access denied");
    }

    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "api_key.deleted" },
    });

    await ctx.db.delete(args.id);
  },
});

export const getLatestByTypeInternal = internalQuery({
  args: {
    userId: v.string(),
    type: apiKeyType,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_user_type", (q) => q.eq("userId", args.userId).eq("type", args.type))
      .order("desc")
      .first();
  },
});
