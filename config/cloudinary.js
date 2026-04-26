import { v2 as cloudinary } from "cloudinary";

let configured = false;

export const isCloudinaryEnabled = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );

const ensureConfigured = () => {
  if (configured) return true;
  if (!isCloudinaryEnabled()) return false;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
  return true;
};

export const uploadBufferToCloudinary = (buffer, { folder, public_id }) =>
  new Promise((resolve, reject) => {
    if (!ensureConfigured()) return reject(new Error("Cloudinary não configurado"));
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id,
        resource_type: "image",
        overwrite: true,
        format: "png",
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });

export const destroyCloudinaryAsset = async (public_id) => {
  if (!ensureConfigured() || !public_id) return;
  try {
    await cloudinary.uploader.destroy(public_id, { resource_type: "image" });
  } catch (err) {
    console.warn("[cloudinary] destroy falhou:", err?.message || err);
  }
};

export { cloudinary };
