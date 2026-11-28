import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { GearAvailability, Prisma } from "@prisma/client";
import { Paginated, buildMeta } from "../common/interfaces/paginated";
import { isUuid } from "../common/utils/uuid";
import { jsonValueToString } from "../common/utils/json";
import { slugify } from "../common/utils/slug";
import { PrismaService } from "../prisma/prisma.service";
import { toReviewDto, ReviewDto } from "../reviews/review.serializer";
import { ALLOWED_SPEC_KEYS, ALL_SPEC_KEYS } from "./dto/spec-keys";
import {
  AdminUpdateGearDto,
  CreateGearDto,
  GearQueryDto,
  UpdateGearDto,
} from "./dto/gear.dto";
import { GearDto, GearWithRelations, toGearDto } from "./gear.serializer";

export interface GearDetailDto extends GearDto {
  reviews: ReviewDto[];
  related: GearDto[];
}

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  icon: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PROVIDER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} as const;

const GEAR_INCLUDE = {
  category: { select: CATEGORY_SELECT },
  provider: { select: PROVIDER_SELECT },
} as const;

function normalizeSpecifications(
  input: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (input === undefined) {
    return undefined;
  }
  const entries = Object.entries(input)
    .map(
      ([key, value]) => [key.trim(), jsonValueToString(value).trim()] as const,
    )
    .filter(([key, value]) => key !== "" && value !== "");
  return Object.fromEntries(entries);
}

@Injectable()
export class GearService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Public reads
  // -------------------------------------------------------------------------

  async findPublic(query: GearQueryDto): Promise<Paginated<GearDto>> {
    return this.queryGear(query, { onlyActive: true });
  }

  async findOne(idOrSlug: string): Promise<GearDetailDto> {
    const gear = await this.prisma.gearItem.findFirst({
      where: isUuid(idOrSlug)
        ? { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
        : { slug: idOrSlug },
      include: GEAR_INCLUDE,
    });

    if (
      !gear ||
      !gear.isActive ||
      gear.availability === GearAvailability.UNAVAILABLE
    ) {
      throw new NotFoundException("کالا یافت نشد");
    }

    const [reviews, related] = await Promise.all([
      this.prisma.review.findMany({
        where: { gearItemId: gear.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { customer: { select: { name: true, avatarUrl: true } } },
      }),
      this.prisma.gearItem.findMany({
        where: {
          categoryId: gear.categoryId,
          isActive: true,
          id: { not: gear.id },
        },
        orderBy: { avgRating: "desc" },
        take: 4,
        include: GEAR_INCLUDE,
      }),
    ]);

    return {
      ...toGearDto(gear),
      reviews: reviews.map(toReviewDto),
      related: related.map((item) => toGearDto(item)),
    };
  }

  // -------------------------------------------------------------------------
  // Provider-scoped
  // -------------------------------------------------------------------------

  async findForProvider(
    providerId: string,
    query: GearQueryDto,
  ): Promise<Paginated<GearDto>> {
    return this.queryGear(query, { onlyActive: false, providerId });
  }

  async create(providerId: string, dto: CreateGearDto): Promise<GearDto> {
    const category = await this.assertCategoryExists(dto.categoryId);
    if (dto.specifications) {
      this.assertSpecificationsAllowed(dto.specifications, category.slug);
    }

    const slug = await this.uniqueSlug(slugify(dto.name, "listing"));

    const gear = await this.prisma.gearItem.create({
      data: {
        providerId,
        categoryId: dto.categoryId,
        name: dto.name.trim(),
        slug,
        description: dto.description.trim(),
        brand: dto.brand?.trim() || null,
        images: dto.images ?? [],
        pricePerDay: dto.pricePerDay,
        stock: dto.stock,
        availableStock: dto.stock,
        specifications: normalizeSpecifications(dto.specifications) ?? {},
        availability: GearAvailability.AVAILABLE,
        isActive: true,
      },
      include: GEAR_INCLUDE,
    });

    return toGearDto(gear);
  }

  async update(
    providerId: string,
    id: string,
    dto: UpdateGearDto,
  ): Promise<GearDto> {
    const existing = await this.loadOwned(providerId, id);

    let categorySlug: string | undefined;
    if (dto.categoryId !== undefined) {
      const category = await this.assertCategoryExists(dto.categoryId);
      categorySlug = category.slug;
    } else {
      categorySlug = (
        await this.prisma.category.findUnique({
          where: { id: existing.categoryId },
          select: { slug: true },
        })
      )?.slug;
    }

    if (dto.specifications) {
      this.assertSpecificationsAllowed(dto.specifications, categorySlug);
    }

    const data: Prisma.GearItemUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined)
      data.description = dto.description.trim();
    if (dto.brand !== undefined) data.brand = dto.brand.trim() || null;
    if (dto.images !== undefined) data.images = dto.images;
    if (dto.pricePerDay !== undefined) data.pricePerDay = dto.pricePerDay;
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } };
    }
    if (dto.specifications !== undefined) {
      data.specifications = normalizeSpecifications(dto.specifications) ?? {};
    }
    if (dto.stock !== undefined) {
      // Keep availability consistent with the stock delta.
      const delta = dto.stock - existing.stock;
      data.stock = dto.stock;
      data.availableStock = Math.max(0, existing.availableStock + delta);
    }
    if (dto.availability !== undefined) {
      data.availability = dto.availability;
      if (dto.availability === "AVAILABLE") {
        data.unavailableReason = null;
      } else if (dto.unavailableReason !== undefined) {
        data.unavailableReason = dto.unavailableReason.trim() || null;
      }
    }

    const gear = await this.prisma.gearItem.update({
      where: { id },
      data,
      include: GEAR_INCLUDE,
    });

    return toGearDto(gear);
  }

  /**
   * Deletes a listing when it has no order history; otherwise archives it
   * (sets `isActive = false`) so past orders stay intact.
   */
  async remove(
    providerId: string,
    id: string,
  ): Promise<{ deleted: boolean; archived: boolean }> {
    await this.loadOwned(providerId, id);

    const orderItems = await this.prisma.rentalOrderItem.count({
      where: { gearItemId: id },
    });

    if (orderItems > 0) {
      await this.prisma.gearItem.update({
        where: { id },
        data: { isActive: false },
      });
      return { deleted: false, archived: true };
    }

    await this.prisma.gearItem.delete({ where: { id } });
    return { deleted: true, archived: false };
  }

  // -------------------------------------------------------------------------
  // Admin-scoped
  // -------------------------------------------------------------------------

  /** Admin listing view — includes inactive/archived listings and provider emails. */
  async findForAdmin(query: GearQueryDto): Promise<Paginated<GearDto>> {
    return this.queryGear(query, { onlyActive: false });
  }

  async adminUpdate(id: string, dto: AdminUpdateGearDto): Promise<GearDto> {
    const exists = await this.prisma.gearItem.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException("کالا یافت نشد");
    }

    const gear = await this.prisma.gearItem.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: GEAR_INCLUDE,
    });

    return toGearDto(gear, { includeProviderEmail: true });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async queryGear(
    query: GearQueryDto,
    opts: { onlyActive: boolean; providerId?: string },
  ): Promise<Paginated<GearDto>> {
    const where: Prisma.GearItemWhereInput = {};

    if (opts.onlyActive) {
      where.isActive = true;
      // Provider-unavailable listings never appear in the public catalog.
      where.availability = { not: GearAvailability.UNAVAILABLE };
    } else if (query.includeInactive === false) {
      where.isActive = true;
    }

    const providerId = opts.providerId ?? query.providerId;
    if (providerId) {
      where.providerId = providerId;
    }

    const term = query.term?.trim();
    if (term) {
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { brand: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
      ];
    }

    if (query.brand) {
      where.brand = { equals: query.brand, mode: "insensitive" };
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.pricePerDay = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
    }

    if (query.category) {
      const category = await this.resolveCategory(query.category);
      if (!category) {
        return new Paginated([], buildMeta(0, query.page, query.limit));
      }
      where.categoryId = category;
    }

    const orderBy = this.buildOrderBy(query.sort);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.gearItem.count({ where }),
      this.prisma.gearItem.findMany({
        where,
        orderBy,
        skip: query.skip,
        take: query.limit,
        include: GEAR_INCLUDE,
      }),
    ]);

    return new Paginated(
      items.map((item) =>
        toGearDto(item as GearWithRelations, {
          includeProviderEmail: !opts.onlyActive,
        }),
      ),
      buildMeta(total, query.page, query.limit),
    );
  }

  private buildOrderBy(
    sort: GearQueryDto["sort"],
  ): Prisma.GearItemOrderByWithRelationInput[] {
    switch (sort) {
      case "price-asc":
        return [{ pricePerDay: "asc" }];
      case "price-desc":
        return [{ pricePerDay: "desc" }];
      case "rating":
        return [{ avgRating: "desc" }, { reviewCount: "desc" }];
      case "recommended":
        return [{ avgRating: "desc" }, { createdAt: "desc" }];
      case "newest":
      default:
        return [{ createdAt: "desc" }];
    }
  }

  private async resolveCategory(value: string): Promise<string | null> {
    const category = await this.prisma.category.findFirst({
      where: isUuid(value)
        ? { OR: [{ id: value }, { slug: value }] }
        : { slug: value },
      select: { id: true },
    });
    return category?.id ?? null;
  }

  private async assertCategoryExists(
    categoryId: string,
  ): Promise<{ slug: string }> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, slug: true },
    });
    if (!category) {
      throw new BadRequestException("دسته‌بندی انتخابی وجود ندارد");
    }
    return { slug: category.slug };
  }

  /** Only catalog-approved specification keys may be stored (#50). */
  private assertSpecificationsAllowed(
    specifications: Record<string, unknown>,
    categorySlug: string | undefined,
  ): void {
    const categoryKeys = categorySlug
      ? ALLOWED_SPEC_KEYS[categorySlug]
      : undefined;
    const allowed = categoryKeys?.length ? categoryKeys : ALL_SPEC_KEYS;
    const invalid = Object.keys(specifications).find(
      (key) => !allowed.includes(key.trim()),
    );
    if (invalid) {
      throw new BadRequestException(
        `مشخصه «${invalid}» مجاز نیست؛ از فهرست مشخصات مجاز استفاده کنید`,
      );
    }
  }

  private async loadOwned(providerId: string, id: string) {
    const gear = await this.prisma.gearItem.findUnique({ where: { id } });
    if (!gear) {
      throw new NotFoundException("کالا یافت نشد");
    }
    if (gear.providerId !== providerId) {
      throw new ForbiddenException("این کالا متعلق به شما نیست");
    }
    return gear;
  }

  private async uniqueSlug(base: string): Promise<string> {
    let candidate = base;
    let counter = 2;
    for (;;) {
      const existing = await this.prisma.gearItem.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
      candidate = `${base}-${counter}`;
      counter += 1;
    }
  }
}
