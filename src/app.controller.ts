import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller()
export class AppController {
  @Get()
  getLandingPage(@Res() res: Response) {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ERPNext Middleware</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-image: url('/bg.avif');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            color: #ffffff;
            height: 100vh;
            position: relative;
          }
          .overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.65); /* Black overlay with opacity */
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }
          .container {
            text-align: center;
            padding: 2rem;
            max-width: 600px;
            z-index: 1; /* Ensure text is above overlay */
          }
          .logo {
            max-width: 150px;
            margin-bottom: 1.5rem;
            filter: brightness(0) invert(1);
          }
          h1 {
            font-weight: 400;
            font-size: 2.5rem;
            margin-bottom: 1rem;
            color: #ffffff;
            letter-spacing: 1px;
          }
          p {
            color: #e0e0e0;
            font-size: 1.1rem;
            line-height: 1.6;
            margin-bottom: 2.5rem;
            margin-left: auto;
            margin-right: auto;
          }
          .buttons {
            display: flex;
            gap: 1rem;
            justify-content: center;
          }
          .btn {
            display: inline-block;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.2s ease;
            background-color: #ffffff;
            color: #ff5e62;
            border: 1px solid #ffffff;
          }
          .btn:hover {
            background-color: rgba(255, 255, 255, 0.9);
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body>
        <div class="overlay">
          <div class="container">
            <h1>Middleware Platform</h1>
            <p>Integration hub connecting ERPNext with Amazon and Flipkart marketplaces.</p>
            <div class="buttons">
              <a href="/admin" class="btn">Admin Login</a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
    res.type('text/html').send(html);
  }
}
