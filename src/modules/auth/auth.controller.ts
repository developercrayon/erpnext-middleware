import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, TokenResponseDto } from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and obtain JWT token' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto): Promise<TokenResponseDto> {
    const { accessToken, expiresIn } = await this.authService.login(dto.email, dto.password);
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  @Post('erpnext-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login via ERPNext and obtain JWT token plus cookies' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials or backend unreachable' })
  async erpnextLogin(@Body() dto: LoginDto): Promise<TokenResponseDto> {
    const { accessToken, expiresIn, cookies, fullName } = await this.authService.erpnextLogin(dto.email, dto.password);
    return { accessToken, tokenType: 'Bearer', expiresIn, cookies, fullName };
  }
}
