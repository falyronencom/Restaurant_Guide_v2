# Seed Images Directory

This directory contains test images for the seed data script (`seed-establishments.js`).

## ⚠️ Important Notice

**These images are NOT tracked in Git** due to their large size (84MB total). They are excluded via `.gitignore`.

## Directory Structure

```
seed-images/
├── food/          # 14 food photos (~42MB)
├── interiors/     # 18 interior photos (~41MB)
└── menus/         # 9 menu photos (~796KB)
```

## How to Obtain Images

### Option 1: Download from Project Archive (Recommended)
If images were provided separately (e.g., via cloud storage link), download and extract them here.

### Option 2: Use Your Own Images
1. Create subdirectories: `food/`, `interiors/`, `menus/`
2. Add your own restaurant images in JPG/PNG format
3. The seed script will automatically use any images found

### Option 3: Download from Unsplash (Original Source)
Most images in this project came from Unsplash. You can download similar images:
- Food photos: https://unsplash.com/s/photos/restaurant-food
- Interior photos: https://unsplash.com/s/photos/restaurant-interior
- Menu photos: https://unsplash.com/s/photos/restaurant-menu

## Image Requirements

- **Formats**: JPG, JPEG, PNG, WEBP
- **Recommended size**: 1920x1080 or higher
- **Minimum**: At least 1 image in each subdirectory for the seed script to work

## Notes

- Images are automatically uploaded to Cloudinary during seeding
- Cloudinary handles optimization and responsive transformations
- Local images are only used once during the seed process
