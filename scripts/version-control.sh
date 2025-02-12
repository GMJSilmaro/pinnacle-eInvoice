#!/bin/bash

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

case $1 in
  major)
    NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$1 = $1 + 1; $2 = 0; $3 = 0} 1' OFS=.)
    ;;
  minor)
    NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$2 = $2 + 1; $3 = 0} 1' OFS=.)
    ;;
  patch)
    NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$3 = $3 + 1} 1' OFS=.)
    ;;
  *)
    echo "Usage: $0 {major|minor|patch}"
    exit 1
    ;;
esac

# Update package.json
npm version $NEW_VERSION --no-git-tag-version

# Create git tag
git tag -a "v$NEW_VERSION" -m "Version $NEW_VERSION"

# Build and tag Docker image
docker build -t $DOCKER_USERNAME/tekauto-einvoice:$NEW_VERSION .
docker tag $DOCKER_USERNAME/tekauto-einvoice:$NEW_VERSION $DOCKER_USERNAME/tekauto-einvoice:latest

echo "Version updated to $NEW_VERSION"
echo "To push changes:"
echo "git push origin v$NEW_VERSION"
echo "docker push $DOCKER_USERNAME/tekauto-einvoice:$NEW_VERSION"
echo "docker push $DOCKER_USERNAME/tekauto-einvoice:latest"
