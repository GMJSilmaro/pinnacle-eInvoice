# eInvoice Portal - Notifications System & Developer Settings

## Overview

This implementation adds a comprehensive notifications system and developer settings to the eInvoice portal, combining internal system notifications with LHDN SDK API notifications, plus advanced portal management features.

## Features Implemented

### 1. Notifications System

#### Internal System Notifications
- **WP_LOGS Integration**: Automatically converts log entries to notifications
- **User-specific Notifications**: Show notifications based on user ID and username
- **Global Announcements**: System-wide announcements visible to all users
- **Priority Levels**: Low, Normal, High, Urgent
- **Notification Types**: System, LHDN, Announcement, Alert

#### LHDN SDK API Integration
- **API Endpoint**: `https://sdk.myinvois.hasil.gov.my/api/06-get-notifications/`
- **Automatic Sync**: Fetch and sync LHDN notifications with local database
- **Token Management**: Uses existing LHDN access token from session
- **Duplicate Prevention**: Prevents duplicate notifications from being created

#### Combined Dashboard
- **Unified View**: Shows both internal and LHDN notifications in one interface
- **Real-time Updates**: Live notification count and status updates
- **Filtering**: Filter by type (all, unread, system, LHDN, announcements)
- **Mark as Read**: Individual and bulk mark as read functionality
- **Search**: Search through notifications by title and content

### 2. Developer Settings (Admin Only)

#### Announcements Management
- **Create/Edit/Delete**: Full CRUD operations for announcements
- **Rich Text Editor**: TinyMCE integration for content creation
- **Scheduling**: Set publish and expiry dates
- **Targeting**: Target specific user roles (all, admin, users)
- **Priority & Types**: Set priority levels and announcement types
- **Popup Notifications**: Option to show announcements as popups on login

#### News & Updates Management
- **News Articles**: Create and manage news articles for the portal
- **Update Notifications**: Notify users about system updates and changes

#### Help System Integration
- **Help URL Management**: Update and manage help system URLs
- **Tutorial Updates**: Integration with existing help system at `http://pxcserver.ddns.net:3000/help#tutorials`

#### Portal Settings
- **API Rate Limiting**: Configure API request limits (default: 300 requests/minute)
- **Session Management**: Configure session timeout settings
- **System Monitoring**: Monitor system health, database status, and LHDN API connectivity

## Database Schema

### New Tables Created

1. **WP_NOTIFICATIONS**
   - Stores all notifications (internal, LHDN, announcements)
   - Supports user targeting, priority levels, and expiration
   - Includes metadata for source tracking

2. **WP_ANNOUNCEMENTS**
   - Manages portal announcements and news
   - Supports scheduling, targeting, and rich content
   - Includes status management (draft, published, archived)

3. **WP_USER_NOTIFICATION_SETTINGS**
   - User-specific notification preferences
   - Controls email, browser, and popup notifications
   - Includes quiet hours and digest frequency settings

## API Endpoints

### Notifications API (`/api/notifications`)
- `GET /` - Get user notifications with filtering
- `GET /unread-count` - Get unread notification count
- `PUT /:id/read` - Mark notification as read
- `PUT /mark-all-read` - Mark all notifications as read
- `POST /` - Create notification (admin only)
- `POST /sync-lhdn` - Sync LHDN notifications
- `GET /lhdn-direct` - Get LHDN notifications directly from API
- `GET /logs` - Get notifications from WP_LOGS
- `GET /combined` - Get combined notifications (internal + LHDN + logs)

### Announcements API (`/api/announcements`)
- `GET /` - Get active announcements for users
- `GET /popup` - Get popup announcements
- `GET /admin` - Get all announcements (admin only)
- `POST /` - Create announcement (admin only)
- `PUT /:id` - Update announcement (admin only)
- `PUT /:id/publish` - Publish announcement (admin only)
- `PUT /:id/archive` - Archive announcement (admin only)
- `DELETE /:id` - Delete announcement (admin only)
- `GET /admin/stats` - Get announcement statistics (admin only)

## Installation & Setup

### 1. Database Migration
```sql
-- Run the migration script
sqlcmd -S your_server -d your_database -i database/notifications_migration.sql
```

### 2. Prisma Schema Update
```bash
# Generate Prisma client with new schema
pnpm prisma generate
```

### 3. Application Restart
```bash
# Restart your application
pm2 restart your-app
# or
pnpm run dev
```

### 4. Access New Features
- **Notifications**: `/dashboard/notifications` (all users)
- **Developer Settings**: `/dashboard/developer-settings` (admin only)

## Usage Guide

### For Regular Users

#### Accessing Notifications
1. Navigate to `/dashboard/notifications`
2. View all notifications in a unified dashboard
3. Filter by type: All, Unread, System, LHDN, Announcements
4. Click on notifications to view details
5. Mark individual notifications as read or mark all as read
6. Sync LHDN notifications manually using the "Sync LHDN" button

#### Notification Types
- **System**: Internal system notifications and log entries
- **LHDN**: Notifications from LHDN API
- **Announcements**: Portal announcements and news
- **Alerts**: High-priority system alerts

### For Administrators

#### Managing Announcements
1. Navigate to `/dashboard/developer-settings`
2. Use the "Announcements" section to:
   - Create new announcements with rich text content
   - Set target audience (all users, admins only, regular users)
   - Schedule publish and expiry dates
   - Set priority levels and announcement types
   - Enable popup notifications for important announcements

#### Creating Announcements
1. Click "New Announcement"
2. Fill in title, content (using rich text editor), and summary
3. Set type: General, Maintenance, Feature, Security
4. Set priority: Low, Normal, High, Urgent
5. Choose target audience and options (pinned, popup)
6. Save as draft or publish immediately

#### Portal Settings
- Configure API rate limiting
- Manage session timeouts
- Monitor system health
- Update help system URLs

## Technical Implementation

### Services
- **NotificationService**: Handles all notification operations
- **AnnouncementService**: Manages announcements and news
- **LHDN Integration**: Syncs with LHDN SDK API

### Frontend Components
- **Notifications Dashboard**: React-like vanilla JS component
- **Developer Settings**: Admin interface for portal management
- **Rich Text Editor**: TinyMCE integration for content creation

### Security Features
- **Admin-only Access**: Developer settings restricted to admin users
- **Input Validation**: All inputs validated and sanitized
- **XSS Protection**: HTML content properly escaped
- **CSRF Protection**: Forms protected against CSRF attacks

## Configuration

### Environment Variables
```env
# LHDN API Configuration (existing)
LHDN_SANDBOX_URL=https://preprod-api.myinvois.hasil.gov.my/api
LHDN_PRODUCTION_URL=https://api.myinvois.hasil.gov.my/api

# Notification Settings
NOTIFICATION_CLEANUP_INTERVAL=86400000  # 24 hours in milliseconds
MAX_NOTIFICATIONS_PER_USER=1000
```

### Default Settings
- **API Rate Limit**: 300 requests per minute (LHDN requirement)
- **Session Timeout**: 30 minutes
- **Notification Retention**: 90 days
- **Max Notifications per User**: 1000

## Monitoring & Maintenance

### Automatic Cleanup
- Expired notifications are automatically cleaned up
- Archived announcements are managed automatically
- Old log entries can be converted to notifications as needed

### Performance Optimization
- Database indexes on frequently queried columns
- Pagination for large notification lists
- Efficient caching for announcement data
- Optimized API calls to LHDN

## Troubleshooting

### Common Issues

1. **LHDN Notifications Not Syncing**
   - Check LHDN access token validity
   - Verify LHDN API endpoint configuration
   - Check network connectivity to LHDN servers

2. **Notifications Not Appearing**
   - Verify user permissions and targeting
   - Check notification expiry dates
   - Ensure database tables are properly created

3. **Rich Text Editor Not Loading**
   - Check TinyMCE CDN connectivity
   - Verify browser JavaScript is enabled
   - Check for console errors

### Support
For technical support or questions about the notification system, contact the development team or refer to the main application documentation.

## Additional Useful Portal Settings

### 1. **API & Performance Management**
- **LHDN API Rate Limiting**: Configure request limits (max 300/minute per LHDN requirements)
- **API Timeout Settings**: Set timeout values for external API calls
- **Retry Logic**: Configure automatic retry attempts for failed requests
- **Connection Pooling**: Manage database connection pools
- **Caching Strategy**: Configure Redis/memory caching for improved performance

### 2. **Security & Authentication**
- **Session Management**: Configure session timeouts and security
- **Login Attempt Limits**: Prevent brute force attacks with lockout mechanisms
- **Two-Factor Authentication**: Enable 2FA for admin accounts
- **HTTPS Enforcement**: Force secure connections
- **IP Whitelisting**: Restrict access to specific IP ranges
- **Password Policies**: Enforce strong password requirements

### 3. **Data Management & Backup**
- **Automated Backups**: Schedule regular database and file backups
- **Data Retention Policies**: Automatically clean up old logs and notifications
- **File Management**: Clean up temporary and old files
- **Log Compression**: Compress old log files to save space
- **Archive Management**: Move old data to archive storage

### 4. **Email & Communication**
- **SMTP Configuration**: Set up email server settings
- **Email Templates**: Manage email notification templates
- **Bulk Email Settings**: Configure mass email capabilities
- **Email Queuing**: Queue email sending for better performance
- **Delivery Tracking**: Track email delivery status

### 5. **System Monitoring & Alerts**
- **Health Checks**: Monitor system components (database, APIs, services)
- **Performance Metrics**: Track response times and system load
- **Error Monitoring**: Alert on system errors and exceptions
- **Disk Space Monitoring**: Alert when disk space is low
- **Memory Usage Tracking**: Monitor application memory consumption

### 6. **Maintenance & Operations**
- **Maintenance Mode**: Schedule or enable immediate maintenance mode
- **System Updates**: Manage application updates and patches
- **Database Maintenance**: Schedule database optimization tasks
- **Log Rotation**: Automatic log file rotation and cleanup
- **Service Restart**: Remote service restart capabilities

### 7. **User Experience**
- **Theme Customization**: Allow users to customize portal appearance
- **Language Settings**: Multi-language support configuration
- **Timezone Management**: Configure default and user-specific timezones
- **Dashboard Customization**: Allow users to customize their dashboard
- **Accessibility Options**: Configure accessibility features

### 8. **Integration Settings**
- **ERP Integration**: Configure SAP, Oracle, or other ERP connections
- **Third-party APIs**: Manage external API integrations
- **Webhook Configuration**: Set up incoming and outgoing webhooks
- **File Transfer**: Configure SFTP/FTP settings for file exchanges
- **Single Sign-On (SSO)**: Configure SAML/OAuth integration

### 9. **Compliance & Auditing**
- **Audit Trail**: Configure detailed audit logging
- **Compliance Reports**: Generate compliance reports automatically
- **Data Privacy**: Configure GDPR/data privacy settings
- **Document Retention**: Set legal document retention periods
- **Access Logging**: Log all user access and actions

### 10. **Performance Optimization**
- **Database Indexing**: Manage database index optimization
- **Query Optimization**: Monitor and optimize slow queries
- **CDN Configuration**: Configure content delivery networks
- **Load Balancing**: Configure load balancer settings
- **Resource Limits**: Set memory and CPU usage limits

## Future Enhancements

### Planned Features
- **Email Notifications**: Send notifications via email
- **SMS Integration**: SMS notifications for critical alerts
- **Mobile Push Notifications**: Push notifications for mobile apps
- **Advanced Filtering**: More sophisticated notification filtering
- **Notification Templates**: Predefined templates for common notifications
- **Analytics Dashboard**: Notification engagement analytics
- **Real-time Dashboard**: Live system monitoring dashboard
- **Custom Widgets**: User-configurable dashboard widgets
- **Advanced Reporting**: Comprehensive system and usage reports

### API Improvements
- **Webhook Support**: Receive notifications via webhooks
- **Batch Operations**: Bulk notification operations
- **Advanced Search**: Full-text search across notifications
- **Export Functionality**: Export notifications to various formats
- **GraphQL API**: Modern GraphQL API for better data fetching
- **Rate Limiting**: Advanced rate limiting with user quotas
