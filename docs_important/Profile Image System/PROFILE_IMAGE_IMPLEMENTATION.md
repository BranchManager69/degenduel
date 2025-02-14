# Profile Image System Implementation Guide

## Overview

The profile image system allows users to upload, update, and delete their profile pictures. The system is designed to be secure, efficient, and easy to integrate with the frontend.

## Technical Specifications

- **Maximum File Size**: 10MB
- **Supported Formats**: jpg, jpeg, png, gif, webp
- **Storage Location**: `/uploads/profile-images/`
- **File Naming**: `${wallet_address}_${timestamp}.${extension}`
- **Access URL**: `${API_URL}/uploads/profile-images/${filename}`

## Database Schema

The user profile image information is stored in the `users` table:

```sql
ALTER TABLE "users" 
ADD COLUMN "profile_image_url" VARCHAR(255),
ADD COLUMN "profile_image_updated_at" TIMESTAMPTZ;
```

## API Endpoints

### 1. Upload/Update Profile Image

```http
POST /api/users/:wallet/profile-image
Content-Type: multipart/form-data
Authorization: Required (JWT via cookie)

Body:
- image: File (Required)

Response (200 OK):
{
  "success": true,
  "message": "Profile image updated successfully",
  "data": {
    "profile_image_url": string,
    "updated_at": string
  }
}

Errors:
- 400: Invalid file type/size
- 403: Unauthorized
- 404: User not found
- 500: Server error
```

### 2. Delete Profile Image

```http
DELETE /api/users/:wallet/profile-image
Authorization: Required (JWT via cookie)

Response (200 OK):
{
  "success": true,
  "message": "Profile image removed successfully"
}

Errors:
- 403: Unauthorized
- 404: User not found/No image
- 500: Server error
```

## Frontend Implementation

### 1. Profile Image Component

```typescript
interface ProfileImageProps {
  walletAddress: string;
  currentImageUrl?: string;
  onImageUpdate: (newUrl: string) => void;
}

const ProfileImage: React.FC<ProfileImageProps> = ({
  walletAddress,
  currentImageUrl,
  onImageUpdate
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  // Implementation...
};
```

### 2. Image Upload Handler

```typescript
const handleImageUpload = async (file: File) => {
  // Validation
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('File size must be less than 10MB');
  }

  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    throw new Error('Invalid file type');
  }

  // Upload
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(
    `/api/users/${walletAddress}/profile-image`,
    {
      method: 'POST',
      body: formData,
      credentials: 'include'
    }
  );

  if (!response.ok) {
    throw new Error('Upload failed');
  }

  const data = await response.json();
  return data.data.profile_image_url;
};
```

### 3. Image Delete Handler

```typescript
const handleImageDelete = async () => {
  const response = await fetch(
    `/api/users/${walletAddress}/profile-image`,
    {
      method: 'DELETE',
      credentials: 'include'
    }
  );

  if (!response.ok) {
    throw new Error('Delete failed');
  }
};
```

### 4. Complete Component Example

```typescript
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

const ProfileImageUpload: React.FC<ProfileImageProps> = ({
  walletAddress,
  currentImageUrl,
  onImageUpdate
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const newUrl = await handleImageUpload(file);
      onImageUpdate(newUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  }, [walletAddress, onImageUpdate]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp']
    },
    maxSize: 10 * 1024 * 1024,
    multiple: false
  });

  return (
    <div className="profile-image-container">
      {currentImageUrl ? (
        <div className="current-image">
          <img src={currentImageUrl} alt="Profile" />
          <button 
            onClick={handleImageDelete}
            className="delete-button"
          >
            Remove
          </button>
        </div>
      ) : (
        <div {...getRootProps()} className="dropzone">
          <input {...getInputProps()} />
          {isDragActive ? (
            <p>Drop the image here...</p>
          ) : (
            <p>Drag & drop or click to select</p>
          )}
        </div>
      )}
      {isUploading && <div className="loading">Uploading...</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
};
```

### 5. Styling

```scss
.profile-image-container {
  position: relative;
  width: 200px;
  height: 200px;
  
  .current-image {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    position: relative;
    
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .delete-button {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px;
      border: none;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s;
      
      &:hover {
        opacity: 1;
      }
    }
  }
  
  .dropzone {
    width: 100%;
    height: 100%;
    border: 2px dashed #ccc;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.2s;
    
    &:hover {
      border-color: #666;
    }
  }
  
  .loading {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .error {
    color: red;
    margin-top: 8px;
    text-align: center;
  }
}
```

## Security Considerations

1. **Authentication**
   - All profile image operations require authentication
   - Users can only modify their own profile images (unless admin/superadmin)

2. **File Validation**
   - File size limit: 10MB
   - Allowed file types: jpg, jpeg, png, gif, webp
   - File extension validation
   - Content-type validation

3. **Storage**
   - Files are stored with unique names to prevent collisions
   - Old files are automatically deleted when updated
   - Files are stored in a dedicated directory with proper permissions

4. **URL Generation**
   - URLs are generated using the API_URL environment variable
   - Files are served through Express static middleware
   - URLs are publicly accessible but file names are unpredictable

## Error Handling

The system handles various error cases:

1. **File Upload Errors**
   - File too large
   - Invalid file type
   - Missing file
   - Upload failure

2. **Authorization Errors**
   - User not found
   - Unauthorized access
   - Invalid session

3. **Server Errors**
   - File system errors
   - Database errors
   - Network errors

## Best Practices

1. **Frontend**
   - Implement client-side file validation
   - Show upload progress
   - Provide image preview
   - Handle errors gracefully
   - Implement retry logic

2. **Backend**
   - Log all operations
   - Clean up old files
   - Validate all inputs
   - Use proper error handling
   - Implement rate limiting

3. **Performance**
   - Optimize image size
   - Use proper caching headers
   - Implement lazy loading
   - Consider CDN integration

## Testing

1. **Unit Tests**
   - File validation
   - URL generation
   - Error handling

2. **Integration Tests**
   - Upload flow
   - Delete flow
   - Authorization

3. **End-to-End Tests**
   - Complete user flow
   - Error scenarios
   - Edge cases

## Monitoring

Monitor the following metrics:

1. **Performance**
   - Upload time
   - File sizes
   - Response times

2. **Errors**
   - Upload failures
   - Validation failures
   - Authorization failures

3. **Storage**
   - Disk usage
   - File counts
   - Cleanup success rate

## Future Improvements

1. **Features**
   - Image cropping
   - Multiple resolutions
   - Bulk upload
   - Gallery support

2. **Performance**
   - CDN integration
   - Image optimization
   - Caching improvements

3. **Security**
   - Virus scanning
   - Content moderation
   - Access control lists 