import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

/**
 * AuthService provides JWT-based authentication for the internal API.
 * In a production setup, users would be stored in the database.
 * For this middleware, we use a single admin user from env config.
 */
@Injectable()
export class AuthService {
  private readonly adminEmail: string;
  private readonly adminPassword: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    // Single admin user — credentials should come from env or DB in production
    this.adminEmail = process.env.ADMIN_EMAIL || 'admin@middleware.local';
    this.adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  }

  async validateUser(email: string, password: string): Promise<JwtPayload | null> {
    if (email === this.adminEmail && password === this.adminPassword) {
      return { sub: 'admin', email, role: 'admin' };
    }
    return null;
  }

  async login(email: string, password: string): Promise<{ accessToken: string; expiresIn: string }> {
    const user = await this.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const expiresIn = this.config.get<string>('jwt.expiresIn') || '7d';
    const accessToken = this.jwtService.sign(
      { sub: user.sub, email: user.email, role: user.role },
      { expiresIn },
    );

    return { accessToken, expiresIn };
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
  async erpnextLogin(email: string, password: string): Promise<{ accessToken: string; expiresIn: string; cookies: string[]; fullName: string }> {
    // We assume the middleware's internal admin credentials are valid to grant the JWT.
    // To make it fully robust, we check ERPNext FIRST.
    
    const baseUrl = this.config.get<string>('ERPNEXT_BASE_URL') || process.env.ERPNEXT_BASE_URL;
    if (!baseUrl) {
      throw new UnauthorizedException('ERPNext Base URL is not configured');
    }

    try {
      const res = await fetch(`${baseUrl}/api/method/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          usr: email,
          pwd: password,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new UnauthorizedException(`ERPNext authentication failed: ${res.statusText}`);
      }

      const erpnextData = await res.json();
      const fullName = erpnextData.full_name || email;

      // Collect the 'set-cookie' headers returned by ERPNext
      const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      let cookies: string[] = [];
      
      // Fallback for Node environments that don't support getSetCookie() yet
      if (rawCookies.length === 0) {
        const headerCookie = res.headers.get("set-cookie");
        if (headerCookie) {
          // A naive split by comma, though getSetCookie is standard in Node 18+
          cookies = headerCookie.split(',').map(c => c.trim());
        }
      } else {
        cookies = rawCookies;
      }

      // Generate the Middleware JWT token for subsequent API requests
      // Using 'admin' role as default since they passed ERPNext auth
      const expiresIn = this.config.get<string>('jwt.expiresIn') || '7d';
      const accessToken = this.jwtService.sign(
        { sub: 'admin', email, role: 'admin' },
        { expiresIn },
      );

      return { accessToken, expiresIn, cookies, fullName };
    } catch (err: any) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException(`Could not connect to ERPNext backend: ${err.message}`);
    }
  }
}
