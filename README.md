# Quoridor

HTML/CSS/JavaScript + PixiJS oyun istemcisi. Vite web çıktısını, Capacitor iOS ve Android projelerini üretir.

## Geliştirme

Node.js 22.12+ gerekir.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Üç sayfa (`index.html`, `profile.html`, `howto.html`) birlikte derlenir. Kaynak dosyaları doğrudan statik sunucuya koymak yerine `dist/` yayımlanmalıdır. Göreli yollar alt dizin barındırmayı destekler.

Firebase SDK, PixiJS, Outfit ve Font Awesome npm üzerinden kilitli sürümlerle paketlenir. Sesler, simge ve PWA manifesti `dist/` içine kopyalanır. Web sürümünde ilk başarılı çevrimiçi yüklemeden sonra service worker tüm yerel kaynakları önbelleğe alır. Güncelleme, açık eski oyun oturumları kapandıktan sonra etkinleşir. Native sürümde kaynaklar uygulamaya gömülüdür ve service worker kaydedilmez. Çevrimiçi maç, profil ve Google girişi internet gerektirir.

## GitHub Pages yayını

Repository Settings → Pages → Build and deployment → Source alanında **GitHub Actions** seçilmelidir. Repo kökünü branch üzerinden yayımlamak npm bağımlılıklarını derlemez; tarayıcıda `Failed to resolve module specifier "@capacitor/core"` hatasına neden olur.

`.github/workflows/pages.yml`, `main` güncellendiğinde bağımlılıkları kurar, testleri ve Vite derlemesini çalıştırır, yalnızca `dist/` çıktısını Pages'e gönderir. Gerekirse Actions → Deploy built game to GitHub Pages → Run workflow ile `main` için yeniden çalıştırılabilir. `base: './'` ayarı `/quoridor/` alt dizinini destekler. PR doğrulaması siteyi yayımlamaz.

Yayın tamamlandıktan sonra eski oyun sekmelerini kapatıp yeniden açın. Hata sürerse önce gizli pencerede kontrol edin; eski service worker önbelleği kalmış olabilir. Site verilerini temizlemek kayıtlı oturumu ve maça dönüş kaydını da siler.

## Mobil projeler

```sh
npm run cap:sync
npm run android
npm run ios
```

- `android/`: Android Studio projesi. Uyumlu Android SDK/JDK kurulumu gerekir.
- `ios/`: Xcode projesi (Swift Package Manager). Derleme ve imzalama macOS/Xcode gerektirir.
- Firebase Android/iOS uygulama kimliği: `com.burakgol.quoridor`. Mağaza ve imzalama kayıtlarında aynı kimliği kullanın.
- Simge/açılış ekranları şu an Capacitor şablonudur; yayın tasarımları değildir.
- `dist/` ve platformlara kopyalanan web çıktıları sürüm kontrolünde tutulmaz. Her kaynak değişikliğinden sonra `npm run cap:sync` çalıştırın.

## Bu aşamadaki düzeltmeler

- Oda oluşturma kod çakışmalarında var olan odayı ezmez.
- Odaya katılım Firebase transaction kullanır; eşzamanlı katılımda ikinci oyuncu yalnızca bir kez atanır. Başarılı sunucu cevabından önce oyun açılmaz.
- Her yeni maçın `matchId` değeri vardır. Rövanşta her iki istemci sayaçlarını, istatistik kayıt bayrağını ve güçlendirme etkilerini temizler.
- Eşzamanlı rövanş istekleri başlayan yeni maçı tekrar sıfırlamaz.
- Native giriş köprüsünün uyumluluk gereksinimi nedeniyle Firebase SDK 12 sürümüne yükseltildi; tam sürümler npm kilit dosyasındadır.

## Yayın öncesinde kalan işler

Bu dal bir mobil temel oluşturur; mağaza yayınına hazır sürüm değildir.

- Sunucuda yetkili hamle/süre doğrulaması. Bu aşamada istemciler Firebase zaman referansını kullanır; backend hakemliği henüz yoktur.
- Oyuncu kimlikleri, sunucuda hamle/sonuç doğrulaması ve gözden geçirilmiş Firebase kuralları. Transaction kullanımı güvenlik doğrulamasının yerini tutmaz; oda kökünde gerekli okuma/yazma izinleri canlı ortamda doğrulanmalıdır.
- Android imzalama sertifikalarının Firebase SHA-1 kayıtları, native Google girişinin cihaz testleri; iOS için giriş seçeneklerinin değerlendirilmesi.
- Hesap silme, gizlilik metinleri, mağaza varlıkları ve native dokunsal geri bildirim.
- Fiziksel cihaz testleri, imzalı AAB/iOS arşivi ve mağaza başvuruları.

## İkinci aşama: saat ve maça dönüş

Çevrimiçi maçlarda `clock.remainingMs` ve `clock.startedAt` saklanır. İstemci `.info/serverTimeOffset` ile ortak zamanı tahmin eder; checkpoint başlangıcı Firebase `serverTimestamp()` ile işaretlenir. Sayaç arayüzü 250 ms aralıklarla kalan süreyi hesaplar. Arka planda sayaç callback'leri çalışmasa da geçen süre hesaba katılır. Hamleler matchId/revision kontrolüyle transaction içinde uygulanır; eski snapshot üzerine yazılmaz. Süresi biten oyuncunun geç gelen hamlesi uygulanmadan maç sonuçlandırılır. İki istemciden biri zaman aşımını sonuçlandırabilir; ikisi de kapalıysa sonraki bağlanışta sonuçlandırılır. Bu yapı sunucu taraflı bir oyun motoru veya hile koruması değildir; ağ gecikmesi/zaman tahmini toleransı vardır.

Bağlantı yokken yeni çevrimiçi hamleler engellenir. `localStorage` içinde 24 saat geçerli oda/koltuk kaydı saklanır. Aynı oda kodu başka bir oda için kullanılırsa `roomSessionId` ve koltuk kimliği eşleşmediği için eski kayıtla girilmez. Bu kimlikler yetkilendirme token'ı değildir; Firebase kuralları ve oyuncu UID doğrulaması hâlâ gereklidir. Web görünür olduğunda, native uygulama ön plana geldiğinde ve Firebase bağlantısı geri geldiğinde güncel oda alınır. Bilerek çıkış, maç bitişi veya AI moduna geçiş kayıtlı çevrimiçi oturumu temizler. Oturum saklama engelliyse oyun çalışır, yeniden açılışta geri dönüş yapılamaz. Bu sürümden önce oluşturulmuş odaları bitirip yeni oda açın; eski istemcilerle karışık çevrimiçi maç desteklenmez.

## Native Google girişini etkinleştirme

Web Google girişi popup kullanmaya devam eder. Native akış `@capacitor-firebase/authentication` ile alınan Google credential'ını Firebase JS oturumuna aktarır; `skipNativeAuth: true` ayarlıdır.

Firebase `quoridor-7a872` projesinde Android ve iOS uygulamaları `com.burakgol.quoridor` kimliğiyle kayıtlıdır. Google sağlayıcısının etkin olduğu konsolda doğrulandı. Gerçek `android/app/google-services.json` ve `ios/App/App/GoogleService-Info.plist` dosyaları projeye eklenmiştir. Bunlar uygulamayla dağıtılan istemci ayarlarıdır; yönetici/service-account anahtarı içermezler.

Auth eklentisi `includePlugins` listesinde etkindir. iOS plist'i App hedefinin Resources bölümüne, gerçek `REVERSED_CLIENT_ID` URL scheme'i Info.plist'e eklenmiştir. Google Android bağımlılık seçimi, iOS Google-only SwiftPM ayarları ve URL callback köprüsü hazırdır. Xcode 16.3+ / Swift 6.1+ gerekir.

Kalan doğrulama:

1. Gerçekte kullanılacak Android debug/release/Play App Signing sertifikalarının SHA-1 parmak izlerini Firebase proje ayarları → Quoridor Android bölümüne ekleyin. Henüz hiçbir Android sertifika parmak izi kaydedilmedi; mevcut yapılandırma yalnızca web OAuth istemcisini içerir. Bu adım olmadan Android Google girişi tamamlanmış sayılmaz.
2. Parmak izlerini ekledikten sonra güncel `google-services.json` dosyasını indirip `android/app/` altındaki dosyayı değiştirin; `npm run cap:sync` çalıştırın.
3. Her iki platformda gerçek cihaz girişi, iptal, çıkış ve uygulama yeniden açılışında oturum kalıcılığını doğrulayın. Web derleme ve Capacitor sync kontrolleri native derleme/OAuth testinin yerini tutmaz.

İlgili kaynaklar: [Firebase saat/bağlantı](https://firebase.google.com/docs/database/web/offline-capabilities), [Google native kurulum](https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/setup-google.md).
