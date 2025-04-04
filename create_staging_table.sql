USE [PXC_TEKAUTO_E_INVOICE_DATABASE]
GO

-- Drop the table if it exists
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[WP_OUTBOUND_STAGING]') AND type in (N'U'))
DROP TABLE [dbo].[WP_OUTBOUND_STAGING]
GO

-- Create the table
CREATE TABLE [dbo].[WP_OUTBOUND_STAGING](
    [id] [int] IDENTITY(1,1) NOT NULL,
    [fileName] [nvarchar](255) NOT NULL,
    [filePath] [nvarchar](500) NOT NULL,
    [invoice_number] [nvarchar](255) NULL,
    [company] [nvarchar](255) NULL,
    [supplier] [ntext] NULL,
    [receiver] [ntext] NULL,
    [file_uploaded] [datetime] NULL,
    [status] [nvarchar](50) NULL DEFAULT ('Pending'),
    [source] [nvarchar](50) NULL,
    [amount] [decimal](18, 2) NULL,
    [document_type] [nvarchar](100) NULL,
    [issue_date] [datetime] NULL,
    [issue_time] [nvarchar](20) NULL,
    [submission_date] [datetime] NULL,
    [uuid] [nvarchar](255) NULL,
    [created_at] [datetime] NOT NULL DEFAULT (GETDATE()),
    [updated_at] [datetime] NOT NULL DEFAULT (GETDATE()),
    CONSTRAINT [PK_WP_OUTBOUND_STAGING] PRIMARY KEY CLUSTERED 
    (
        [id] ASC
    )
)
GO

-- Create indexes for better performance
CREATE INDEX [idx_invoice_number] ON [dbo].[WP_OUTBOUND_STAGING] ([invoice_number])
GO
CREATE INDEX [idx_fileName] ON [dbo].[WP_OUTBOUND_STAGING] ([fileName])
GO
CREATE INDEX [idx_status] ON [dbo].[WP_OUTBOUND_STAGING] ([status])
GO

PRINT 'WP_OUTBOUND_STAGING table created successfully.'
GO 