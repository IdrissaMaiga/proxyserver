import express from 'express';
import fetch from 'node-fetch';
import { URL } from 'url';
import rateLimit from 'express-rate-limit';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import stream from 'stream';
const app = express();
const PORT = process.env.PORT || 3000
ffmpeg.setFfmpegPath(ffmpegStatic);
// Middleware to parse JSON and query parameters
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const EPG_URL = 'http://763025459169.cdn-fug.com:2082/player_api.php';
const STREAMING_URL="http://stream.filmutunnel.site";
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



app.get('/proxy/video/:url', async (req, res) => {
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
            headers.Range = req.headers.range; // Forward Range header for partial content
        }

        // Fetch the video content with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

        const response = await fetch(parsedUrl.toString(), { headers, signal: controller.signal });
        clearTimeout(timeout);

        // Forward response headers and status
        res.status(response.status);
        response.headers.forEach((value, key) => res.setHeader(key, value));

        // Handle client disconnections
        req.on('close', () => {
            if (!res.writableEnded) {
                response.body?.destroy(); // Abort the fetch request
            }
        });

        // Stream content to the client
        if (response.body) {
            response.body.pipe(res);
            response.body.on('error', (err) => {
                console.error('Stream error:', err.message);
                res.end(); // Ensure the response ends on stream error
            });
        } else {
            res.end();
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('Fetch request timed out.');
            res.status(504).send('Upstream request timed out.');
        } else {
            console.error(`Error fetching URL: ${error.message}`);
            res.status(500).send('Error fetching the requested resource.');
        }
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
            headers.Range = req.headers.range; // Forward Range header for seeking
        }

        // Fetch the video content with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

        const response = await fetch(parsedUrl.toString(), { headers, signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
            return res.status(response.status).send('Error fetching the video.');
        }

        // Handle client disconnections
        req.on('close', () => {
            if (!res.writableEnded) {
                response.body?.destroy(); // Abort upstream fetch
                passThroughStream?.destroy(); // Cleanup FFmpeg stream
            }
        });

        // Stream the input content to FFmpeg
        const inputStream = response.body;
        const passThroughStream = new stream.PassThrough();

        // Set response headers
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Connection', 'keep-alive');

        // Transcode using FFmpeg
        const ffmpegProcess = ffmpeg(inputStream)
            .format('mp4') // Output format
            .videoCodec('libx264') // Video codec
            .audioCodec('aac') // Audio codec
            .outputOptions([
                '-preset fast', // Encoding preset
                '-movflags frag_keyframe+empty_moov' // Streaming-friendly MP4
            ])
            .on('error', (err) => {
                console.error('FFmpeg error:', err.message);
                if (!res.headersSent) {
                    res.status(500).end('Error during transcoding.');
                }
            })
            .on('end', () => {
                console.log('FFmpeg transcoding finished.');
            })
            .pipe(passThroughStream);

        // Pipe the transcoded stream to the client
        passThroughStream.pipe(res);

        // Cleanup FFmpeg process on client disconnect
        req.on('close', () => {
            ffmpegProcess.kill('SIGKILL'); // Force-stop FFmpeg
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('Fetch request timed out.');
            res.status(504).send('Upstream request timed out.');
        } else {
            console.error(`Error: ${error.message}`);
            res.status(500).send('Internal server error.');
        }
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

        // Set HTTP headers for live streaming
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Connection', 'keep-alive');

        // Handle client disconnections
        let isClientDisconnected = false;
        req.on('close', () => {
            isClientDisconnected = true;
            if (ffmpegProcess) ffmpegProcess.kill('SIGKILL'); // Force-stop FFmpeg on disconnect
        });

        // Configure FFmpeg for live transcoding
        const ffmpegProcess = ffmpeg(decodedUrl)
            .inputOptions([
                '-f hls',         // Specify input format as HLS
                '-re',            // Read input at native frame rate
                '-fflags +genpts' // Generate presentation timestamps
            ])
            .outputFormat('mp4')
            .videoCodec('libx264')
            .audioCodec('aac') // Audio encoding
            .outputOptions([
                '-movflags frag_keyframe+empty_moov', // Fragmented MP4 for streaming
                '-preset veryfast',                  // Balance speed and quality
                '-tune zerolatency',                 // Optimize for low latency
                '-crf 23',                           // Video quality level
                '-b:v 1M',                           // Video bitrate (1 Mbps)
                '-maxrate 1M',                       // Limit peak bitrate
                '-bufsize 2M'                        // Buffer size for smoother playback
            ])
            .on('start', () => {
                console.log(`FFmpeg streaming started for URL: ${decodedUrl}`);
            })
            .on('error', (err) => {
                console.error(`FFmpeg error: ${err.message}`);
                if (!res.headersSent) {
                    res.status(500).send('Error processing the video stream.');
                }
            })
            .on('end', () => {
                console.log('FFmpeg streaming ended.');
                if (!res.headersSent) {
                    res.end();
                }
            });

        // Pipe FFmpeg output to the response
        ffmpegProcess.pipe(res, { end: true });

        // Monitor FFmpeg progress
        ffmpegProcess.on('progress', (progress) => {
            if (isClientDisconnected) {
                console.log('Client disconnected. Killing FFmpeg process.');
                ffmpegProcess.kill('SIGKILL');
            }
        });
    } catch (error) {
        console.error(`Error: ${error.message}`);
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
