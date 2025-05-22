BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Session] (
    [id] NVARCHAR(36) NOT NULL,
    [sid] NVARCHAR(255) NOT NULL,
    [data] NVARCHAR(max) NOT NULL,
    [expires] DATETIME NOT NULL,
    [createdAt] DATETIME NOT NULL CONSTRAINT [Session_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME NOT NULL CONSTRAINT [Session_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Session_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Session_sid_key] UNIQUE NONCLUSTERED ([sid])
);

-- CreateTable
CREATE TABLE [dbo].[WP_ADMIN_SETTINGS] (
    [ID] INT NOT NULL IDENTITY(1,1),
    [SettingKey] NVARCHAR(255) NOT NULL,
    [SettingValue] NTEXT NOT NULL,
    [SettingGroup] NVARCHAR(100) NOT NULL,
    [Description] NVARCHAR(500),
    [IsActive] BIT CONSTRAINT [DF__WP_ADMIN___IsAct__440B1D61] DEFAULT 1,
    [CreatedBy] NVARCHAR(255),
    [UpdatedBy] NVARCHAR(255),
    [CreateTS] DATETIME CONSTRAINT [DF__WP_ADMIN___Creat__44FF419A] DEFAULT CURRENT_TIMESTAMP,
    [UpdateTS] DATETIME CONSTRAINT [DF__WP_ADMIN___Updat__45F365D3] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK__WP_ADMIN__3214EC27A76C4CE2] PRIMARY KEY CLUSTERED ([ID]),
    CONSTRAINT [UQ_WP_ADMIN_SETTINGS_SettingKey] UNIQUE NONCLUSTERED ([SettingKey])
);

-- CreateTable
CREATE TABLE [dbo].[WP_COMPANY_SETTINGS] (
    [ID] INT NOT NULL IDENTITY(1,1),
    [CompanyImage] VARCHAR(255),
    [CompanyName] VARCHAR(255),
    [Industry] VARCHAR(255),
    [Country] VARCHAR(255),
    [TIN] VARCHAR(255),
    [BRN] VARCHAR(255),
    [About] TEXT,
    [Address] VARCHAR(255),
    [Phone] VARCHAR(255),
    [Email] VARCHAR(255),
    [ValidStatus] VARCHAR(255),
    [UserID] VARCHAR(255),
    CONSTRAINT [PK__WP_COMPA__3214EC27D59FCF90] PRIMARY KEY CLUSTERED ([ID])
);

-- CreateTable
CREATE TABLE [dbo].[WP_CONFIGURATION] (
    [ID] INT NOT NULL IDENTITY(1,1),
    [Type] VARCHAR(50) NOT NULL,
    [UserID] VARCHAR(255) NOT NULL,
    [Settings] NVARCHAR(max) NOT NULL,
    [IsActive] BIT CONSTRAINT [DF__WP_CONFIG__IsAct__2D27B809] DEFAULT 1,
    [CreateTS] DATETIME NOT NULL,
    [UpdateTS] DATETIME NOT NULL,
    CONSTRAINT [PK__WP_CONFI__3214EC27B0AA7610] PRIMARY KEY CLUSTERED ([ID])
);

-- CreateTable
CREATE TABLE [dbo].[WP_FLATFILE] (
    [id] INT NOT NULL IDENTITY(1,1),
    [supplier_name] VARCHAR(255) NOT NULL,
    [supplier_tin] VARCHAR(50) NOT NULL,
    [supplier_brn] VARCHAR(50),
    [supplier_msic] VARCHAR(20),
    [supplier_sst] VARCHAR(50),
    [buyer_name] VARCHAR(255) NOT NULL,
    [buyer_tin] VARCHAR(50) NOT NULL,
    [buyer_brn] VARCHAR(50),
    [buyer_sst] VARCHAR(50),
    [invoice_no] VARCHAR(50) NOT NULL,
    [invoice_date] DATE NOT NULL,
    [currency_code] VARCHAR(3) CONSTRAINT [DF__WP_FLATFI__curre__787EE5A0] DEFAULT 'MYR',
    [exchange_rate] DECIMAL(10,4) CONSTRAINT [DF__WP_FLATFI__excha__797309D9] DEFAULT 1.0000,
    [item_description] TEXT,
    [classification] VARCHAR(10),
    [tax_type] VARCHAR(10),
    [tax_rate] DECIMAL(5,2),
    [tax_amount] DECIMAL(15,2),
    [total_excl_tax] DECIMAL(15,2) NOT NULL,
    [total_incl_tax] DECIMAL(15,2) NOT NULL,
    [status] VARCHAR(20) CONSTRAINT [DF__WP_FLATFI__statu__7A672E12] DEFAULT 'Pending',
    [is_mapped] BIT CONSTRAINT [DF__WP_FLATFI__is_ma__7B5B524B] DEFAULT 0,
    [mapping_details] NVARCHAR(max),
    [upload_date] DATETIME CONSTRAINT [DF__WP_FLATFI__uploa__7C4F7684] DEFAULT CURRENT_TIMESTAMP,
    [processed_date] DATETIME,
    [processed_by] VARCHAR(50),
    [submission_id] VARCHAR(50),
    [lhdn_response] NVARCHAR(max),
    [uuid] VARCHAR(36),
    CONSTRAINT [PK__WP_FLATF__3213E83F3B2E347A] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ__WP_FLATF__7F427931935AC3F5] UNIQUE NONCLUSTERED ([uuid])
);

-- CreateTable
CREATE TABLE [dbo].[WP_INBOUND_STATUS] (
    [uuid] VARCHAR(100) NOT NULL,
    [submissionUid] VARCHAR(100),
    [longId] VARCHAR(100),
    [internalId] VARCHAR(50),
    [typeName] VARCHAR(50),
    [typeVersionName] VARCHAR(50),
    [issuerTin] VARCHAR(50),
    [issuerName] VARCHAR(255),
    [receiverId] VARCHAR(50),
    [receiverName] VARCHAR(255),
    [dateTimeReceived] VARCHAR(100),
    [dateTimeValidated] VARCHAR(100),
    [status] VARCHAR(50),
    [documentStatusReason] VARCHAR(500),
    [cancelDateTime] VARCHAR(100),
    [rejectRequestDateTime] VARCHAR(100),
    [createdByUserId] VARCHAR(100),
    [dateTimeIssued] VARCHAR(100),
    [totalSales] DECIMAL(18,2),
    [totalExcludingTax] DECIMAL(18,2),
    [totalDiscount] DECIMAL(18,2),
    [totalNetAmount] DECIMAL(18,2),
    [totalPayableAmount] DECIMAL(18,2),
    [last_sync_date] VARCHAR(100),
    [sync_status] VARCHAR(50),
    [documentDetails] TEXT,
    [validationResults] TEXT,
    [document] TEXT,
    [created_at] VARCHAR(100) NOT NULL CONSTRAINT [DF__WP_INBOUN__creat__49C3F6B7] DEFAULT 'getdate()',
    [updated_at] VARCHAR(100) NOT NULL CONSTRAINT [DF__WP_INBOUN__updat__4AB81AF0] DEFAULT 'getdate()',
    CONSTRAINT [PK__WP_INBOU__7F42793064BFCB78] PRIMARY KEY CLUSTERED ([uuid])
);

-- CreateTable
CREATE TABLE [dbo].[WP_LOGS] (
    [ID] INT NOT NULL IDENTITY(1,1),
    [Description] VARCHAR(255),
    [CreateTS] VARCHAR(255),
    [LoggedUser] VARCHAR(255),
    [IPAddress] VARCHAR(255),
    [LogType] VARCHAR(255),
    [Module] VARCHAR(255),
    [Action] VARCHAR(255),
    [Status] VARCHAR(255),
    [UserID] INT,
    CONSTRAINT [PK__WP_LOGS__3214EC279D2627EB] PRIMARY KEY CLUSTERED ([ID])
);

-- CreateTable
CREATE TABLE [dbo].[WP_OUTBOUND_STATUS] (
    [id] INT NOT NULL IDENTITY(1,1),
    [UUID] VARCHAR(255),
    [submissionUid] VARCHAR(255) NOT NULL,
    [company] VARCHAR(255),
    [supplier] VARCHAR(255),
    [receiver] VARCHAR(255),
    [fileName] VARCHAR(255) NOT NULL,
    [filePath] VARCHAR(255) NOT NULL,
    [invoice_number] VARCHAR(255) NOT NULL,
    [source] VARCHAR(255),
    [amount] VARCHAR(255),
    [document_type] VARCHAR(255),
    [status] VARCHAR(50) NOT NULL CONSTRAINT [DF__WP_OUTBOU__statu__6754599E] DEFAULT 'Pending',
    [date_submitted] DATETIME,
    [date_sync] DATETIME,
    [date_cancelled] DATETIME,
    [cancelled_by] VARCHAR(255),
    [cancellation_reason] VARCHAR(max),
    [created_at] DATETIME NOT NULL CONSTRAINT [DF__WP_OUTBOU__creat__68487DD7] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME NOT NULL CONSTRAINT [DF__WP_OUTBOU__updat__693CA210] DEFAULT CURRENT_TIMESTAMP,
    [submitted_by] VARCHAR(255),
    CONSTRAINT [PK__WP_OUTBO__3213E83FE0938CCA] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ__WP_OUTBO__B1C86A949B85C631] UNIQUE NONCLUSTERED ([filePath])
);

-- CreateTable
CREATE TABLE [dbo].[WP_SFTP_CONFIG] (
    [id] INT NOT NULL IDENTITY(1,1),
    [host] VARCHAR(255) NOT NULL,
    [port] VARCHAR(10) CONSTRAINT [DF__WP_SFTP_CO__port__34C8D9D1] DEFAULT '22',
    [username] VARCHAR(255) NOT NULL,
    [password] VARCHAR(255) NOT NULL,
    [root_path] VARCHAR(255) CONSTRAINT [DF__WP_SFTP_C__root___35BCFE0A] DEFAULT '/eInvoiceFTP',
    [incoming_manual_template] VARCHAR(255),
    [incoming_schedule_template] VARCHAR(255),
    [outgoing_manual_template] VARCHAR(255),
    [outgoing_schedule_template] VARCHAR(255),
    [is_active] BIT CONSTRAINT [DF__WP_SFTP_C__is_ac__36B12243] DEFAULT 1,
    [createdAt] VARCHAR(50) NOT NULL CONSTRAINT [DF__WP_SFTP_C__creat__37A5467C] DEFAULT 'format(getdate(),''yyyy-MM-dd HH:mm:ss'')',
    [updatedAt] VARCHAR(50) NOT NULL CONSTRAINT [DF__WP_SFTP_C__updat__38996AB5] DEFAULT 'format(getdate(),''yyyy-MM-dd HH:mm:ss'')',
    CONSTRAINT [PK__WP_SFTP___3213E83F1C4C692F] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_SFTP_HOST_USERNAME] UNIQUE NONCLUSTERED ([host],[username])
);

-- CreateTable
CREATE TABLE [dbo].[WP_SUBMISSION_STATUS] (
    [DocNum] VARCHAR(255) NOT NULL,
    [UUID] VARCHAR(255),
    [SubmissionUID] VARCHAR(255),
    [SubmissionStatus] VARCHAR(255),
    [DateTimeSent] DATETIME,
    [DateTimeUpdated] DATETIME,
    [RejectionDetails] TEXT,
    [FileName] VARCHAR(255),
    CONSTRAINT [PK_WP_SUBMISSION_STATUS] PRIMARY KEY CLUSTERED ([DocNum]),
    CONSTRAINT [UQ_WP_SUBMISSION_STATUS_FILENAME] UNIQUE NONCLUSTERED ([FileName])
);

-- CreateTable
CREATE TABLE [dbo].[WP_USER_REGISTRATION] (
    [ID] INT NOT NULL IDENTITY(1,1),
    [FullName] VARCHAR(255),
    [Email] VARCHAR(255),
    [Username] VARCHAR(255),
    [Password] VARCHAR(255),
    [UserType] VARCHAR(255),
    [TIN] VARCHAR(255),
    [IDType] VARCHAR(255),
    [IDValue] VARCHAR(255),
    [ClientID] VARCHAR(255),
    [ClientSecret] VARCHAR(255),
    [DigitalSignaturePath] VARCHAR(255),
    [DigitalSignatureFileName] VARCHAR(255),
    [Admin] INT,
    [CreateTS] DATETIME,
    [Phone] VARCHAR(50),
    [ValidStatus] CHAR(1) CONSTRAINT [DF__WP_USER_R__Valid__267ABA7A] DEFAULT '1',
    [LastLoginTime] DATETIME,
    [ProfilePicture] VARCHAR(255),
    [TwoFactorEnabled] BIT CONSTRAINT [DF__WP_USER_R__TwoFa__276EDEB3] DEFAULT 0,
    [NotificationsEnabled] BIT CONSTRAINT [DF__WP_USER_R__Notif__286302EC] DEFAULT 0,
    [UpdateTS] DATETIME,
    CONSTRAINT [PK__WP_USER___3214EC2734F875D6] PRIMARY KEY CLUSTERED ([ID]),
    CONSTRAINT [UQ__WP_USER___A9D10534353262BA] UNIQUE NONCLUSTERED ([Email]),
    CONSTRAINT [UQ__WP_USER___536C85E42E91CB0A] UNIQUE NONCLUSTERED ([Username])
);

-- CreateTable
CREATE TABLE [dbo].[LHDN_TOKENS] (
    [id] INT NOT NULL IDENTITY(1,1),
    [access_token] VARCHAR(4000) NOT NULL,
    [expiry_time] DATETIME NOT NULL,
    [created_at] DATETIME NOT NULL CONSTRAINT [LHDN_TOKENS_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LHDN_TOKENS_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_session_expires] ON [dbo].[Session]([expires]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_session_sid] ON [dbo].[Session]([sid]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_WP_ADMIN_SETTINGS_IsActive] ON [dbo].[WP_ADMIN_SETTINGS]([IsActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_WP_ADMIN_SETTINGS_SettingGroup] ON [dbo].[WP_ADMIN_SETTINGS]([SettingGroup]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_buyer_tin] ON [dbo].[WP_FLATFILE]([buyer_tin]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_invoice_date] ON [dbo].[WP_FLATFILE]([invoice_date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_invoice_no] ON [dbo].[WP_FLATFILE]([invoice_no]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_is_mapped] ON [dbo].[WP_FLATFILE]([is_mapped]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_status] ON [dbo].[WP_FLATFILE]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_supplier_tin] ON [dbo].[WP_FLATFILE]([supplier_tin]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_upload_date] ON [dbo].[WP_FLATFILE]([upload_date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_WP_INBOUND_STATUS_dateTimeReceived] ON [dbo].[WP_INBOUND_STATUS]([dateTimeReceived] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_WP_INBOUND_STATUS_issuerTin] ON [dbo].[WP_INBOUND_STATUS]([issuerTin]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_WP_INBOUND_STATUS_last_sync_date] ON [dbo].[WP_INBOUND_STATUS]([last_sync_date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_WP_INBOUND_STATUS_status] ON [dbo].[WP_INBOUND_STATUS]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_WP_OUTBOUND_STATUS_INVOICE_NUMBER] ON [dbo].[WP_OUTBOUND_STATUS]([invoice_number]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_WP_OUTBOUND_STATUS_UUID] ON [dbo].[WP_OUTBOUND_STATUS]([UUID]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_lhdn_tokens_expiry] ON [dbo].[LHDN_TOKENS]([expiry_time]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
