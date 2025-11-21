/**
 * Upload PPT/PPTX file to Google Drive and convert to Google Slides
 * Fixed version that works in both Node.js and browser environments
 */
async uploadPowerPointToGoogleSlides(filePath, title) {
    try {
        console.log(`📤 Uploading ${path.basename(filePath)} to Google Slides...`);
        
        // Determine the correct MIME type based on file extension
        const extension = path.extname(filePath).toLowerCase();
        let mimeType;
        
        if (extension === '.ppt') {
            mimeType = 'application/vnd.ms-powerpoint';
        } else if (extension === '.pptx') {
            mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        } else {
            throw new Error(`Unsupported file type: ${extension}. Only .ppt and .pptx files are supported.`);
        }

        // File metadata - IMPORTANT: Set parents as empty array for root folder
        const fileMetadata = {
            name: title,
            parents: [], // This will put the file in the root folder
            // This is the KEY: specify the target MIME type to convert to Google Slides
            mimeType: 'application/vnd.google-apps.presentation'
        };

        // Read file content properly for the environment
        let fileContent;
        let mediaConfig;

        // Check if we're in Node.js environment
        if (typeof window === 'undefined' && typeof require !== 'undefined') {
            // Node.js environment
            try {
                // Option 1: Read entire file into buffer (better for smaller files)
                fileContent = await fs.readFile(filePath);
                
                mediaConfig = {
                    mimeType: mimeType, // Original file MIME type
                    body: fileContent, // Use buffer directly
                };
            } catch (readError) {
                // Option 2: Use createReadStream if buffer approach fails
                const fsStream = await import('fs');
                mediaConfig = {
                    mimeType: mimeType,
                    body: fsStream.createReadStream(filePath),
                };
            }
        } else {
            // Browser environment - handle File API
            if (filePath instanceof File) {
                // If filePath is actually a File object
                fileContent = await filePath.arrayBuffer();
                mediaConfig = {
                    mimeType: mimeType,
                    body: new Uint8Array(fileContent),
                };
            } else {
                // If we have a file path in browser, we need to fetch it
                try {
                    const response = await fetch(filePath);
                    fileContent = await response.arrayBuffer();
                    mediaConfig = {
                        mimeType: mimeType,
                        body: new Uint8Array(fileContent),
                    };
                } catch (fetchError) {
                    throw new Error(`Cannot access file in browser environment: ${fetchError.message}`);
                }
            }
        }

        // Upload and convert using Google Drive API
        const driveResponse = await this.drive.files.create({
            resource: fileMetadata,
            media: mediaConfig,
            fields: 'id,name,webViewLink,mimeType',
        });

        const fileId = driveResponse.data.id;
        const webViewLink = driveResponse.data.webViewLink;
        const editLink = `https://docs.google.com/presentation/d/${fileId}/edit`;

        console.log(`✅ Successfully converted to Google Slides: ${driveResponse.data.name}`);
        console.log(`🔗 View Link: ${webViewLink}`);
        console.log(`✏️  Edit Link: ${editLink}`);

        return {
            fileId: fileId,
            name: driveResponse.data.name,
            webViewLink: webViewLink,
            editLink: editLink,
            mimeType: driveResponse.data.mimeType
        };
        
    } catch (error) {
        console.error(`❌ Failed to upload to Google Slides: ${error.message}`);
        
        // Provide more detailed error messages
        if (error.message.includes('fs.createReadStream is not a function')) {
            console.error('💡 Environment error: This appears to be a browser environment where file system access is limited');
            console.error('💡 Consider using the File API or ensure this runs in a Node.js environment');
        } else if (error.message.includes('insufficientPermissions')) {
            console.error('💡 Permission error: Make sure your OAuth credentials have Google Drive and Slides API access');
        } else if (error.message.includes('quotaExceeded')) {
            console.error('💡 Quota exceeded: You may have reached your Google Drive storage or API quota limits');
        } else if (error.message.includes('fileNotFound')) {
            console.error('💡 File not found: Check if the PPT/PPTX file exists and is accessible');
        }
        
        throw error;
    }
}

/**
 * Alternative method for browser environments using File input
 * Call this method when you have a File object from an HTML input
 */
async uploadFileToGoogleSlides(file, title) {
    try {
        console.log(`📤 Uploading ${file.name} to Google Slides...`);
        
        // Determine MIME type from file
        const extension = file.name.split('.').pop().toLowerCase();
        let mimeType;
        
        if (extension === 'ppt') {
            mimeType = 'application/vnd.ms-powerpoint';
        } else if (extension === 'pptx') {
            mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        } else {
            throw new Error(`Unsupported file type: .${extension}. Only .ppt and .pptx files are supported.`);
        }

        // File metadata
        const fileMetadata = {
            name: title || file.name,
            parents: [],
            mimeType: 'application/vnd.google-apps.presentation'
        };

        // Convert File to ArrayBuffer
        const fileContent = await file.arrayBuffer();

        // Media configuration
        const media = {
            mimeType: mimeType,
            body: new Uint8Array(fileContent),
        };

        // Upload and convert using Google Drive API
        const driveResponse = await this.drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id,name,webViewLink,mimeType',
        });

        const fileId = driveResponse.data.id;
        const webViewLink = driveResponse.data.webViewLink;
        const editLink = `https://docs.google.com/presentation/d/${fileId}/edit`;

        console.log(`✅ Successfully converted to Google Slides: ${driveResponse.data.name}`);
        console.log(`🔗 View Link: ${webViewLink}`);
        console.log(`✏️  Edit Link: ${editLink}`);

        return {
            fileId: fileId,
            name: driveResponse.data.name,
            webViewLink: webViewLink,
            editLink: editLink,
            mimeType: driveResponse.data.mimeType
        };
        
    } catch (error) {
        console.error(`❌ Failed to upload File to Google Slides: ${error.message}`);
        throw error;
    }
}

/**
 * Environment detection utility
 */
isNodeEnvironment() {
    return typeof window === 'undefined' && 
           typeof require !== 'undefined' && 
           typeof process !== 'undefined' && 
           process.versions && 
           process.versions.node;
}

isBrowserEnvironment() {
    return typeof window !== 'undefined' && 
           typeof document !== 'undefined';
}
