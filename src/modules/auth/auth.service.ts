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
}
