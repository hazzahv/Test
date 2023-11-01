require('dotenv').config();
const AWS = require('aws-sdk');
const Jimp = require('jimp'); // Use Jimp library

const bucketName = 'augmentation-bucket';

// Configure AWS SDK with your credentials
AWS.config.update({
  region: 'ap-southeast-2', // Replace with your preferred region
});
// Create an SQS service object
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

(async () => {
  try {
    await s3.createBucket({ Bucket: bucketName }).promise();
    console.log(`Created bucket: ${bucketName}`);
  } catch (err) {
    if (err.statusCode !== 409) {
      console.log(`Error creating bucket: ${err}`);
    }
  }
})();

// Specify the URL of your SQS queue
const queueUrl = 'https://sqs.ap-southeast-2.amazonaws.com/901444280953/photoQueueTest';

// Function to poll for and process messages from the SQS queue
function receiveMessages() {
  const params = {
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 1, // Maximum number of messages to retrieve
    WaitTimeSeconds: 20, // Long polling for messages
  };

  sqs.receiveMessage(params, (err, data) => {
    if (err) {
      console.error('Error receiving message:', err);
    } else if (data.Messages) {
      const message = data.Messages[0];
      console.log('Received message:', message.Body);

      // Process the message here
      const params = {
        Bucket: bucketName,
        Key: `Pre-Processing/${message.Body}`,
      };

      s3.getObject(params, (err, data) => {
        if (err) {
          console.error('Error reading image from S3:', err);
        } else {
          // The image data can be found in data.Body
          const imageData = data.Body;

          // Use Jimp for image processing
          Jimp.read(imageData, (jimpErr, image) => {
            if (jimpErr) {
              console.error('Error processing image with Jimp:', jimpErr);
            } else {
              // Process the image using Jimp
              image
                .quality(50) // Adjust image quality
                .resize(2000,1000)
                .rotate(45)
                .getBuffer(Jimp.MIME_JPEG, (jimpBufferErr, processedImageData) => {
                  if (jimpBufferErr) {
                    console.error('Error getting Jimp buffer:', jimpBufferErr);
                  } else {
                    // Upload the processed image to S3
                    const params = {
                      Bucket: bucketName,
                      Key: `Post-Processing/${message.Body}`,
                      Body: processedImageData,
                      ContentType: 'image/jpeg',
                    };
                    s3.upload(params, (s3Err, s3Data) => {
                      if (s3Err) {
                        console.error('Error uploading image to S3:', s3Err);
                      } else {
                        console.log('Image uploaded to S3:', s3Data.Location);

                        // Delete the message from the queue after processing
                        const deleteParams = {
                          QueueUrl: queueUrl,
                          ReceiptHandle: message.ReceiptHandle,
                        };
                        sqs.deleteMessage(deleteParams, (deleteErr) => {
                          if (deleteErr) {
                            console.error('Error deleting message:', deleteErr);
                          } else {
                            console.log('Message deleted');
                          }
                        });
                      }
                    });
                  }
                });
            }
          });
        }
      });
      // Continue polling for more messages
      receiveMessages();
    } else {
      console.log('No messages to process');
      receiveMessages(); // Continue polling for messages
    }
  });
}

// Start polling for messages
receiveMessages();
