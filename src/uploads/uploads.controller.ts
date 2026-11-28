import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { extname, join } from "path";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Role } from "@prisma/client";
import { MAX_UPLOAD_BYTES } from "../gear/gear-limits";

const UPLOAD_DIR = join(process.cwd(), "uploads");

@ApiTags("uploads")
@ApiCookieAuth("accessToken")
@Controller("uploads")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PROVIDER, Role.ADMIN)
export class UploadsController {
  @Post("images")
  @ApiOperation({ summary: "Upload a gear image (max 2 MB)" })
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          if (!existsSync(UPLOAD_DIR))
            mkdirSync(UPLOAD_DIR, { recursive: true });
          callback(null, UPLOAD_DIR);
        },
        filename: (_req, file, callback) => {
          const ext = extname(file.originalname).toLowerCase();
          callback(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.startsWith("image/")) {
          callback(new BadRequestException("فقط فایل تصویر مجاز است"), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("فایلی ارسال نشد");
    }
    return { url: `/uploads/${file.filename}` };
  }
}
