import express from 'express';
import fetch from 'node-fetch';
import { URL } from 'url';
import rateLimit from 'express-rate-limit';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import stream from 'stream';
const app = express();
const PORT = 3000;
ffmpeg.setFfmpegPath(ffmpegStatic);
// Middleware to parse JSON and query parameters
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const EPG_URL = 'http://763025459169.cdn-fug.com:2082/player_api.php';
const STREAMING_URL='http://763025459169.cdn-fug.com:8080';
const serieiInfoEndpoint='/player_api.php?username=115763054352463&password=iuadobbh3v&action=get_series_info&series_id='  ///  we give the id 18495
// Rate limiter to prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Middleware to add CORS headers
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});



// Media route
app.get('/proxy/serieinfo/:url', async (req, res) => {
    try {
        const { url } = req.params;
        const parsedUrl = STREAMING_URL+serieiInfoEndpoint+(new URL(decodeURIComponent(url)));
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            return res.status(400).send('Invalid protocol. Only HTTP and HTTPS are allowed.');
        }

        const response = await fetch(parsedUrl.toString());

        res.status(response.status);
        response.headers.forEach((value, key) => res.setHeader(key, value));
        response.body.pipe(res);
    } catch (error) {
        //console.error(`Error fetching URL: ${error.message}`);
        res.status(500).send('Error fetching the requested resource.');
    }
});




// Proxy EPG API requests
app.get('/proxy/epg', async (req, res) => {
    try {
        const { username, password, action, stream_id } = req.query;
        // Validate required parameters
        if (!username || !password || !action) {
            return res.status(400).send('Missing required parameters.');
        }

        // Construct the proxied URL
        const url = new URL(EPG_URL);
        url.searchParams.append('username', username);
        url.searchParams.append('password', password);
        url.searchParams.append('action', action);
        if (stream_id) url.searchParams.append('stream_id', stream_id);

        // Fetch data from the original backend
        const response = await fetch(url.toString());
        const data = await response.text();

        // Forward the response to the client
        res.status(response.status).send(data);
    } catch (error) {
        //console.error(`Error fetching EPG: ${error.message}`);
        res.status(500).send('Error fetching EPG.');
    }
});


// Media route
app.get('/proxy/media/:url', async (req, res) => {
    try {
        const { url } = req.params;
        const parsedUrl = new URL(decodeURIComponent(url));
    
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            return res.status(400).send('Invalid protocol. Only HTTP and HTTPS are allowed.');
        }

        const response = await fetch(parsedUrl.toString());

        res.status(response.status);
        response.headers.forEach((value, key) => res.setHeader(key, value));
        response.body.pipe(res);
    } catch (error) {
       // console.error(`Error fetching URL: ${error.message}`);
        res.status(500).send('Error fetching the requested resource.');
    }
});



// Proxy route
app.get('/proxy/video/:url', async (req, res) => {
    try {
        const { url } = req.params;
        const decodedUrl = STREAMING_URL + decodeURIComponent(url);
        const parsedUrl = new URL(decodedUrl);

       // console.log("Video streaming request received");

        // Validate protocol
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            return res.status(400).send('Invalid protocol. Only HTTP and HTTPS are allowed.');
        }

        // Prepare headers for the external request
        const headers = {};
        if (req.headers.range) {
            headers.Range = req.headers.range;
        }

        // Fetch the video content
        const response = await fetch(parsedUrl.toString(), { headers });

        // Forward response headers and status
        res.status(response.status);
        response.headers.forEach((value, key) => res.setHeader(key, value));

        // Stream content to the client
        if (response.body) {
            response.body.pipe(res);
            response.body.on('error', (err) => {
                //console.error('Stream error:', err.message);
                res.end(); // Ensure the response ends on stream error
            });
        } else {
            res.end();
        }
    } catch (error) {
       // console.error(`Error fetching URL: ${error.message}`);
        res.status(500).send('Error fetching the requested resource.');
    }
});



app.get('/proxy/video1/:url', async (req, res) => {
    try {
        const { url } = req.params;
        const decodedUrl = STREAMING_URL + decodeURIComponent(url);
        const parsedUrl = new URL(decodedUrl);

        // Validate protocol
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            return res.status(400).send('Invalid protocol. Only HTTP and HTTPS are allowed.');
        }

        // Prepare headers for the external request
        const headers = {};
        if (req.headers.range) {
            headers.Range = req.headers.range;
        }

        // Fetch the video content
        const response = await fetch(parsedUrl.toString(), { headers });

        if (!response.ok) {
            return res.status(response.status).send('Error fetching the video.');
        }

        // Stream the input content to FFmpeg
        const inputStream = response.body;
        const passThroughStream = new stream.PassThrough();

        // Set response headers
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Transfer-Encoding', 'chunked');

        // Transcode using FFmpeg
        ffmpeg(inputStream)
            .format('mp4') // Output format
            .videoCodec('libx264') // Video codec
            .audioCodec('aac') // Audio codec
            .outputOptions([
                '-preset fast', // Encoding preset
                '-movflags frag_keyframe+empty_moov' // Enable streaming-friendly MP4
            ])
            .on('error', (err) => {
               // console.error('FFmpeg error:', err.message);
                res.status(500).end('Error during transcoding.');
            })
            .pipe(passThroughStream);

        // Pipe the transcoded stream to the client
        passThroughStream.pipe(res);
    } catch (error) {
       // console.error(`Error: ${error.message}`);
        res.status(500).send('Internal server error.');
    }
});


app.get('/proxy/live/:encodedUrl', async (req, res) => {
    try {
        const { encodedUrl } = req.params;
        const decodedUrl = STREAMING_URL + decodeURIComponent(encodedUrl);

        // Validate that the URL ends with .m3u8
        if (!decodedUrl.endsWith('.m3u8')) {
            return res.status(400).send('The URL must point to a .m3u8 file.');
        }

        // Set HTTP headers for optimized streaming
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Connection', 'keep-alive');

        // Configure FFmpeg for transcoding and streaming
        const ffmpegProcess = ffmpeg(decodedUrl)
            .inputOptions([
                '-f hls',         // Specify input format as HLS
                '-re',            // Read input at native frame rate for real-time processing
                '-fflags +genpts' // Generate presentation timestamps to ensure sync
            ])
            .outputFormat('mp4')
            .videoCodec('libx264')
            .audioCodec('aac') // Ensure proper audio encoding
            .outputOptions([
                '-movflags frag_keyframe+empty_moov', // Fragmented MP4 for better streaming
                '-preset veryfast',                  // Balance between speed and quality
                '-tune zerolatency',                 // Optimize for low latency
                '-crf 23',                           // Video quality level (lower is better)
                '-b:v 1M',                           // Set video bitrate (1 Mbps)
                '-maxrate 1M',                       // Limit peak bitrate
                '-bufsize 2M'                        // Buffer size for smoother streaming
            ])
            .on('start', () => {
               // console.log(`FFmpeg streaming started for URL: ${decodedUrl}`);
            })
            .on('error', (err) => {
              //  console.error(`FFmpeg error: ${err.message}`);
                if (!res.headersSent) {
                    res.status(500).send('Error processing the video stream.');
                }
            })
            .on('end', () => {
               // console.log('FFmpeg streaming ended.');
                if (!res.headersSent) {
                    res.end();
                }
            });

        // Pipe the output of FFmpeg directly to the response
        ffmpegProcess.pipe(res, { end: true });
    } catch (error) {
        //console.error(`Error: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).send('Error fetching or processing the requested resource.');
        }
    }
});




// Fallback for unknown routes
app.use((req, res) => {
    res.status(404).send(`Endpoint not found: ${req.originalUrl}`);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
