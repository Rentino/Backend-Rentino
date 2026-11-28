import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";
import {
  MAX_GEAR_IMAGES,
  MAX_GEAR_SPECS,
  MAX_IMAGE_URL_LENGTH,
  MAX_SPEC_KEY_LENGTH,
  MAX_SPEC_VALUE_LENGTH,
} from "../gear-limits";
import { ALL_SPEC_KEYS, isValidImageUrl } from "./spec-keys";

const GEAR_SORTS = [
  "recommended",
  "price-asc",
  "price-desc",
  "rating",
  "newest",
] as const;

export type GearSort = (typeof GEAR_SORTS)[number];

/** https links and local `/images/...` paths are both valid image sources. */
function IsImageUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isImageUrl",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === "string" && isValidImageUrl(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property}: آدرس تصویر معتبر نیست؛ از لینک http(s) یا مسیر /images/... استفاده کنید`;
        },
      },
    });
  };
}

/** Validates flat `Record<string, string>` specification maps. */
function IsSpecifications(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isSpecifications",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return false;
          }
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > MAX_GEAR_SPECS) return false;
          return entries.every(
            ([key, val]) =>
              key.trim().length > 0 &&
              key.trim().length <= MAX_SPEC_KEY_LENGTH &&
              ALL_SPEC_KEYS.includes(key.trim()) &&
              typeof val === "string" &&
              val.trim().length <= MAX_SPEC_VALUE_LENGTH,
          );
        },
        defaultMessage() {
          return `مشخصات نامعتبر است؛ حداکثر ${MAX_GEAR_SPECS} مشخصه از فهرست مجاز با مقادیر متنی کوتاه مجاز است`;
        },
      },
    });
  };
}

export class CreateGearDto {
  @ApiProperty({ example: "پلیاستیشن ۵" })
  @IsString({ message: "نام کالا باید متن باشد" })
  @MinLength(2, { message: "نام کالا باید حداقل ۲ کاراکتر باشد" })
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: "کنسول بازی سونی" })
  @IsString({ message: "توضیحات باید متن باشد" })
  @MinLength(2, { message: "توضیحات را وارد کنید" })
  @MaxLength(2000)
  description!: string;

  @ApiProperty()
  @IsUUID("4", { message: "شناسه دستهبندی نامعتبر است" })
  categoryId!: string;

  @ApiPropertyOptional({ example: "Sony" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @ApiPropertyOptional({
    type: [String],
    description: `Between 1 and ${MAX_GEAR_IMAGES} image URLs or local paths`,
  })
  @IsArray()
  @ArrayMaxSize(MAX_GEAR_IMAGES, {
    message: `حداکثر ${MAX_GEAR_IMAGES} تصویر مجاز است`,
  })
  @IsString({ each: true })
  @MaxLength(MAX_IMAGE_URL_LENGTH, { each: true })
  @IsImageUrl({ each: true })
  images: string[] = [];

  @ApiProperty({ example: 4000000, description: "Price per day in Rial" })
  @Type(() => Number)
  @IsInt({ message: "قیمت باید عدد صحیح (ریال) باشد" })
  @Min(1, { message: "قیمت باید بیشتر از صفر باشد" })
  pricePerDay!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: "موجودی باید عدد صحیح باشد" })
  @Min(0, { message: "موجودی نمیتواند منفی باشد" })
  stock!: number;

  @ApiPropertyOptional({ type: Object, example: { رزولوشن: "۴K" } })
  @IsOptional()
  @IsObject({ message: "مشخصات باید یک شیء باشد" })
  @IsSpecifications()
  specifications?: Record<string, string>;
}

export class UpdateGearDto extends PartialType(CreateGearDto) {
  @ApiPropertyOptional({
    enum: ["AVAILABLE", "UNAVAILABLE", "MAINTENANCE"],
    description: "Provider-controlled listing state (#54)",
  })
  @IsOptional()
  @IsIn(["AVAILABLE", "UNAVAILABLE", "MAINTENANCE"], {
    message: "وضعیت موجودی نامعتبر است",
  })
  availability?: "AVAILABLE" | "UNAVAILABLE" | "MAINTENANCE";

  @ApiPropertyOptional({ example: "تعمیرات" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  unavailableReason?: string;
}

export class AdminUpdateGearDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: "وضعیت نمایش باید بولین باشد" })
  isActive?: boolean;
}

export class GearQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 20;

  @ApiPropertyOptional({ description: "Category slug or id" })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: "Free-text search over name/brand/description",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Alias for `search`" })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ description: "Minimum price per day (Rial)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: "Maximum price per day (Rial)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: GEAR_SORTS, default: "newest" })
  @IsOptional()
  @IsIn(GEAR_SORTS, { message: "ترتیب مرتبسازی نامعتبر است" })
  sort?: GearSort;

  @ApiPropertyOptional({
    description: "Filter by provider id (admin/provider)",
  })
  @IsOptional()
  @IsString()
  providerId?: string;

  @ApiPropertyOptional({
    description: "Include hidden (inactive) listings — admin only",
  })
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  includeInactive?: boolean;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }

  get term(): string | undefined {
    return this.search ?? this.q;
  }
}
