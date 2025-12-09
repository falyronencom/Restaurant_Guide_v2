# Seed Images Directory

## Overview
This directory contains sample images used for seeding the database with test establishments data.

## Why are these files not in Git?
These image files are **intentionally excluded** from version control because:
- They are large binary files (84MB total)
- Binary files bloat the repository and slow down clone/pull operations
- They are only needed for development/testing, not production
- They can be easily regenerated or downloaded

## Directory Structure
```
seed-images/
├── food/        # 14 food images (~42MB)
├── interiors/   # 18 interior images (~41MB)
└── menus/       # 9 menu images (~796KB)
```

## How to Get the Images

### Option 1: Download from Cloud Storage (Recommended)
If your team has set up cloud storage for these assets:
```bash
# Example - replace with your actual cloud storage URL
# gsutil -m cp -r gs://your-bucket/seed-images/* ./scripts/seed-images/
# or
# aws s3 sync s3://your-bucket/seed-images ./scripts/seed-images/
```

### Option 2: Use Your Own Images
You can use any images you have. Just place them in the appropriate subdirectories:
- `food/` - Restaurant food photos (JPG format, any resolution)
- `interiors/` - Restaurant interior photos (JPG format, any resolution)
- `menus/` - Menu photos (JPG/JPEG format, any resolution)

### Option 3: Download Free Stock Images
Download free images from:
- [Unsplash](https://unsplash.com/)
- [Pexels](https://pexels.com/)
- [Pixabay](https://pixabay.com/)

Search for terms like "restaurant food", "restaurant interior", "menu board", etc.

## Required Files
The seeding scripts expect to find images in these directories. The exact number and names don't matter, but you should have:
- At least 10-15 images in `food/`
- At least 10-15 images in `interiors/`
- At least 5-10 images in `menus/`

## Note for New Developers
If you're setting up this project for the first time and don't need to seed the database with images, you can skip downloading these files. The application will work fine without them.
