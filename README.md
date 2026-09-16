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

## Mobil projeler

```sh
npm run cap:sync
npm run android
npm run ios
```

- `android/`: Android Studio projesi. Uyumlu Android SDK/JDK kurulumu gerekir.
- `ios/`: Xcode projesi (Swift Package Manager). Derleme ve imzalama macOS/Xcode gerektirir.
- Geçici uygulama kimliği: `com.burakgol.quoridor`. Mağaza kaydı ve imzalamadan önce kesinleştirin.
- Simge/açılış ekranları şu an Capacitor şablonudur; yayın tasarımları değildir.
- `dist/` ve platformlara kopyalanan web çıktıları sürüm kontrolünde tutulmaz. Her kaynak değişikliğinden sonra `npm run cap:sync` çalıştırın.

## Bu aşamadaki düzeltmeler

- Oda oluşturma kod çakışmalarında var olan odayı ezmez.
- Odaya katılım Firebase transaction kullanır; eşzamanlı katılımda ikinci oyuncu yalnızca bir kez atanır. Başarılı sunucu cevabından önce oyun açılmaz.
- Her yeni maçın `matchId` değeri vardır. Rövanşta her iki istemci sayaçlarını, istatistik kayıt bayrağını ve güçlendirme etkilerini temizler.
- Eşzamanlı rövanş istekleri başlayan yeni maçı tekrar sıfırlamaz.
- Firebase sürümü, bu geçişi SDK yükseltmesiyle karıştırmamak için mevcut 10.7.1 sürümünde tutuldu.

## Yayın öncesinde kalan işler

Bu dal bir mobil temel oluşturur; mağaza yayınına hazır sürüm değildir.

- Sunucu zamanına dayanan maç süresi, yeniden bağlanma ve kalıcı maç oturumu.
- Oyuncu kimlikleri, sunucuda hamle/sonuç doğrulaması ve gözden geçirilmiş Firebase kuralları. Transaction kullanımı güvenlik doğrulamasının yerini tutmaz; oda kökünde gerekli okuma/yazma izinleri canlı ortamda doğrulanmalıdır.
- Native Google giriş akışı ve iOS için giriş seçeneklerinin değerlendirilmesi.
- Hesap silme, gizlilik metinleri, mağaza varlıkları ve native dokunsal geri bildirim.
- Fiziksel cihaz testleri, imzalı AAB/iOS arşivi ve mağaza başvuruları.
