import { Query, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

@Resolver()
@AllowAnonymous()
export class ViewerResolver {
  @Query(() => String, { nullable: true, deprecationReason: "Placeholder" })
  placeholder() {
    return null
  }
}
