import "./globals.css";

export const metadata = {
    title: "TikTok Sentiment Analyzer",
    description: "Analyze TikTok comments using AI",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="vi">
            <body>

                {/* HEADER */}
                <header className="bg-white shadow-sm border-b">
                    <div className="container flex justify-between items-center">
                        <h1 className="text-xl font-semibold">
                            TikTok Analyzer
                        </h1>

                        <div className="text-sm text-gray-500">
                            AI Dashboard
                        </div>
                    </div>
                </header>

                {/* MAIN CONTENT */}
                <main className="container mt-6">
                    {children}
                </main>

            </body>
        </html>
    );
}