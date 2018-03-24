const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const mkdirp = require('mkdirp-promise');
// Include a Service Account Key to use a Signed URL
const gcs = require('@google-cloud/storage')({ keyFilename: 'key.json' });

const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;


const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');
const fs = require('fs');



// Thumbnail prefix added to file names.
const THUMB_PREFIX = 'thumb_';

//scale size ,it will be scaled to 500px X 281px
const scale = 500;

exports.generateThumbnailFromVideo = functions.storage.object().onChange(event => {
  //RAW folder/Video.mp4
  const originalFilePath = event.data.name;

  
  console.log("filePath IS ",originalFilePath);
  

  //FILE DIR "."
  const originalFileDir = path.dirname(originalFilePath);

  console.log("FILE DIR IS ",originalFileDir);

  //Video.mp4
  const originalFileName = path.basename(originalFilePath);

  console.log("FILE NAME IS ",originalFileName);
  

  // /tmp/folder/Video.mp4
  const tempFilePath = path.join(os.tmpdir(), originalFilePath);
  console.log("tempLocalFile IS ",tempFilePath);
  
  // /tmp/folder
  const tempFileDir = path.dirname(tempFilePath);
  console.log("tempLocalDir IS ",tempFileDir);
  
//RAW folder/thumb_video.jpg

  const thumbFilePath = path.normalize(path.join(originalFileDir, `${THUMB_PREFIX}${originalFileName.replace(path.extname(originalFileName),".jpg")}`))
  
  console.log("thumbFilePath IS ",thumbFilePath);
  

  //tmp/thumb_image.jpg  
  const tempLocalThumbFile = path.join(os.tmpdir(), thumbFilePath);
  console.log("tempLocalThumbFile IS ",tempLocalThumbFile);
  

  if (!event.data.contentType.startsWith('video/')) {
    console.log('This is not a video.');
    return null;
  }


  // Exit if the image is already a thumbnail.
  if (originalFileName.startsWith(THUMB_PREFIX)) {
    console.log('Already a Thumbnail.');
    return null;
  }

  // Exit if this is a move or deletion event.
  if (event.data.resourceState === 'not_exists') {
    console.log('This is a deletion event.');
    return null;
  }

  // Cloud Storage files.
  const bucket = gcs.bucket(event.data.bucket);
  const file = bucket.file(originalFilePath);
  const thumbFile = bucket.file(thumbFilePath);
  
  console.log("thumbFile is ",thumbFile);

  // Create the temp directory where the storage file will be downloaded.
  return mkdirp(tempFileDir).then(() => {
    // Download file from bucket.
    return file.download({ destination: tempFilePath });
  }).then(() => {


    console.log('The file has been downloaded to', tempFilePath);

    return spawn(ffmpeg, ['-ss', '0', '-i', tempFilePath, '-f', 'image2', '-vframes', '1', '-vf', `scale=${scale}:-1`, tempLocalThumbFile]);
    
  }).then(() => {



    console.log('Thumbnail created at', tempLocalThumbFile);
    // Uploading the Thumbnail.
    return bucket.upload(tempLocalThumbFile, { destination: thumbFilePath });

  }).then(() => {
    console.log('Thumbnail uploaded to Storage at', thumbFilePath);
    // Once the image has been uploaded delete the local files to free up disk space.
    fs.unlinkSync(tempFilePath);
    fs.unlinkSync(tempLocalThumbFile);
    const config = {
      action: 'read',
      expires: '03-01-2500',
    };
    return Promise.all([
      thumbFile.getSignedUrl(config),
      file.getSignedUrl(config),
    ]);
  }).then((results) => {
    console.log('Got Signed URLs.');
    const thumbResult = results[0];
    const originalResult = results[1];
    const thumbFileUrl = thumbResult[0];
    const fileUrl = originalResult[0];
    // Add the URLs to the Database
    return admin.database().ref('videos').push({ videoUrl: fileUrl, thumbnailUrl: thumbFileUrl });
  }).then(() => console.log('Thumbnail URLs saved to database.'));
});
